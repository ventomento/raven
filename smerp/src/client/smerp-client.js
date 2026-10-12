// src/client/smerp-client.js

import { PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { StorageMemory } from "../storage/storage-memory.js";
import { TransportDefault } from "../transport/transport-default.js";
import { LightLog } from "../log/light-log.js";
import { RealClock } from "../lib/clock.js";
import { RelayRateLimits } from "../relay/rate-limits.js";
import { RelayPool } from "../relay/relay-pool.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { NotStartedError } from "./errors.js";
import { composeClient } from "./compose.js";
import { runMigrations } from "./migrations.js";

export const ClientStatus = Object.freeze({
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
});

/**
 * Reference smerp client.
 *
 * Headless: holds no view state. A UI sends with send(), reads local
 * data through the <resource>Get/Put/Delete methods and reacts to
 * events subscribed with on().
 *
 * Local storage access follows one convention for every resource:
 *
 *   <resource>Get(options)    query, returns an array (possibly empty)
 *   <resource>Put(record)     insert or replace by primary key
 *   <resource>Delete(options) remove by primary key, returns count
 *
 * The client is a facade: the work is done by the modules composeClient
 * builds on start (MessageStore, RelayDirectory, RelayPool, Sender).
 */
export class SmerpClient {

  constructor({
    identity,
    transporter = TransportDefault,
    storage = new StorageMemory(),
    logger = new LightLog(),
    syncIntervalMs = 60 * 1000,
    // Per relay, shared by fetches and sends. Protects the relay.
    relayRateLimit = RelayRateLimits.DEFAULTS,
    // Requests in flight at once, over all relays. Protects the client.
    slots = RelayPool.DEFAULTS.slots,
    // { now(), sleep(ms), timer(ms, fn) }. All times are milliseconds.
    clock = RealClock,
  }) {

    insist(identity, PrivateIdentity);

    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.logger = logger;
    this.syncIntervalMs = syncIntervalMs;
    this.slots = slots;
    this.clock = clock;

    // Outlives start/stop so a restart cannot reset a relay's budget.
    this.rateLimits = new RelayRateLimits({ ...relayRateLimit, clock });

    this.eventBus = new EventBus();
    this.status = ClientStatus.STOPPED;
    this.publicKeyHex = null;
    this.services = null;
    this.syncIntervalId = null;
  }

  // =====================================================
  // Lifecycle
  // =====================================================

  async start() {

    if (this.status !== ClientStatus.STOPPED) {
      return;
    }

    this.#setStatus(ClientStatus.STARTING);

    try {

      await this.storage.init();

      this.publicKeyHex =
        this.identity.publicKeyHex ??
        await this.identity.exportPublicHex();

      this.services = composeClient({
        identity: this.identity,
        publicKeyHex: this.publicKeyHex,
        transporter: this.transporter,
        storage: this.storage,
        eventBus: this.eventBus,
        logger: this.logger,
        clock: this.clock,
        rateLimits: this.rateLimits,
        slots: this.slots,
      });

      await runMigrations(this.services);

      for (const relay of await this.services.directory.relaysGet()) {
        this.services.pool.upsert(relay);
      }
    }
    catch (error) {
      this.services = null;
      await this.storage.close();
      this.#setStatus(ClientStatus.STOPPED);
      throw error;
    }

    this.#setStatus(ClientStatus.RUNNING);

    void this.sync();

    this.syncIntervalId = setInterval(
      () => void this.sync(),
      this.syncIntervalMs
    );
  }

  async stop() {

    if (this.status !== ClientStatus.RUNNING) {
      return;
    }

    this.#setStatus(ClientStatus.STOPPING);

    clearInterval(this.syncIntervalId);
    this.syncIntervalId = null;

    await this.services.pool.stop();
    await this.storage.close();

    this.services = null;

    this.#setStatus(ClientStatus.STOPPED);
  }

  /**
   * Sync all enabled relays now: wakes every relay that is caught up.
   * The returned promise resolves when the pool has nothing left to do
   * but wait for relays that are throttled or backing off.
   * Never rejects: failures are published as "error" events.
   */
  sync() {

    this.#assertRunning();

    return this.services.pool.wakeIdle();
  }

  // =====================================================
  // Events
  // =====================================================

  /**
   * Subscribe to a client event. Returns an unsubscribe function.
   * See EventTypes for event names and payloads.
   */
  on(eventType, callback) {
    return this.eventBus.subscribe(eventType, callback);
  }

  // =====================================================
  // Envelopes
  // =====================================================

  /**
   * options: {} | { uuid } | { publicKeyHex, beforeSentAt?, beforeReceivedAt?, limit? }
   * Sorted newest first (sentAt, then receivedAt). To page, pass the
   * sentAt and receivedAt of the previous page's last envelope.
   */
  async envelopesGet(options = {}) {

    this.#assertRunning();

    return this.services.messages.envelopesGet(options);
  }

  /**
   * Encrypt plaintext for a recipient and upload it to every relay.
   *
   * plaintext: string | Uint8Array (a Node Buffer is a Uint8Array).
   * contentType: defaults to TEXT_UTF8 for strings, UNKNOWN for bytes.
   * The envelope may be at most 4 MiB.
   *
   * Resolves once at least one relay accepted it, with the envelope
   * uuid and per-relay results. Throws DispatchError if no relay
   * accepted it.
   *
   * Nothing is stored here. Like every envelope, it is stored when a
   * sync fetches it back from a relay; send() starts that sync. Watch
   * for the "envelope" event with this uuid.
   */
  async send(recipientPublicKeyHex, plaintext, options = {}) {

    this.#assertRunning();

    return this.services.sender.send(recipientPublicKeyHex, plaintext, options);
  }

  // =====================================================
  // Conversations
  // =====================================================

  /**
   * options: {} | { publicKeyHex }
   * Sorted by lastMessageAt, newest first.
   */
  async conversationsGet(options = {}) {

    this.#assertRunning();

    return this.services.messages.conversationsGet(options);
  }

  /**
   * Insert or replace a conversation, e.g. to mark it read:
   *
   *   const [c] = await client.conversationsGet({ publicKeyHex });
   *   await client.conversationsPut({ ...c, unreadCount: 0 });
   *
   * Last write wins: an envelope ingested between the get and the put
   * has its unread increment overwritten.
   */
  async conversationsPut(conversation) {

    this.#assertRunning();

    return this.services.messages.conversationsPut(conversation);
  }

  // =====================================================
  // Relays
  // =====================================================

  /**
   * options: {} | { relayUrl }
   */
  async relaysGet(options = {}) {

    this.#assertRunning();

    return this.services.directory.relaysGet(options);
  }

  /**
   * Insert or replace a relay, keyed by relayUrl.
   * relayPkh is optional: it is learned from the relay's responses.
   * relayToken is optional: an access token issued by the relay's
   * operator, sent as a bearer token on every request to that relay.
   * A relay that is already syncing keeps its sync state (cursor, key,
   * failure counts) and writes it back on its next request.
   */
  async relaysPut(relay) {

    this.#assertRunning();

    const key = await this.services.directory.put(relay);

    this.services.pool.upsert(relay);

    void this.sync();

    return key;
  }

  /**
   * options: { relayUrl }
   * Returns the number of relays removed (0 or 1).
   */
  async relaysDelete({ relayUrl }) {

    this.#assertRunning();

    const count = await this.services.directory.delete({ relayUrl });

    this.services.pool.remove(relayUrl);

    return count;
  }

  // =====================================================
  // Internal
  // =====================================================

  #assertRunning() {
    if (this.status !== ClientStatus.RUNNING) {
      throw new NotStartedError();
    }
  }

  #setStatus(status) {

    this.status = status;

    this.eventBus.publish({
      type: EventTypes.STATUS,
      status,
    });
  }
}
