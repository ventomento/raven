// src/client/smerp-client.js

import {
  encrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../../smep/src/index.js";

import { insist } from "../../../smep/src/util/util.js";
import { Serializer } from "../../../smep/src/envelope/serializer.js";
import { ContentTypes } from "../../../smep/src/envelope/content-types.js";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { StorageMemory } from "../storage/storage-memory.js";
import { RequestBuilder } from "../request/request-builder.js";
import { TransportDefault } from "../transport/transport-default.js";
import { SyncEngine } from "../sync/sync-engine.js";
import { LightLog } from "../log/light-log.js";
import { Ingestor } from "../ingest/ingestor.js";
import { RealClock, RelayRateLimits, retryAfterMs } from "../sync/rate-limiter.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { NotStartedError, DispatchError } from "./errors.js";

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
    // { now(): ms, sleep(ms): Promise }. All times are milliseconds.
    clock = RealClock,
  }) {

    insist(identity, PrivateIdentity);

    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.logger = logger;
    this.syncIntervalMs = syncIntervalMs;
    this.clock = clock;

    // Outlives start/stop so a restart cannot reset a relay's budget.
    this.rateLimits = new RelayRateLimits({ ...relayRateLimit, clock });

    this.eventBus = new EventBus();
    this.status = ClientStatus.STOPPED;
    this.publicKeyHex = null;
    this.ingestor = null;
    this.syncEngine = null;
    this.syncPromise = null;
    this.syncAgain = false;
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

      this.ingestor =
        new Ingestor({
          storage: this.storage,
          identity: this.identity,
          eventBus: this.eventBus,
          logger: this.logger,
          clock: this.clock,
        });

      this.syncEngine =
        new SyncEngine({
          identity: this.identity,
          transporter: this.transporter,
          storage: this.storage,
          ingestor: this.ingestor,
          logger: this.logger,
          eventBus: this.eventBus,
          pkh: this.publicKeyHex,
          clock: this.clock,
          rateLimits: this.rateLimits,
        });

      await this.#resetSyncDisabledRelays();
    }
    catch (error) {
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

    await this.syncPromise;
    await this.storage.close();

    this.ingestor = null;
    this.syncEngine = null;

    this.#setStatus(ClientStatus.STOPPED);
  }

  /**
   * Sync all enabled relays now. A call made while a sync is running
   * schedules one more run after it, so nothing uploaded in between is
   * missed; the returned promise covers that run too.
   * Never rejects: failures are published as "error" events.
   */
  sync() {

    this.#assertRunning();

    if (this.syncPromise) {
      this.syncAgain = true;
      return this.syncPromise;
    }

    this.syncPromise =
      this.#syncLoop()
      .finally(() => {
        this.syncPromise = null;
      });

    return this.syncPromise;
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

    return this.storage.envelopesGet(options);
  }

  // =====================================================
  // Send
  // =====================================================

  /**
   * Encrypt plaintext for a recipient and upload it to every relay.
   *
   * plaintext: string | Uint8Array (a Node Buffer is a Uint8Array).
   * contentType: defaults to TEXT_UTF8 for strings, UNKNOWN for bytes.
   *
   * Resolves once at least one relay accepted it, with the envelope
   * uuid and per-relay results. Throws DispatchError if no relay
   * accepted it.
   *
   * Nothing is stored here. Like every envelope, it is stored when a
   * sync fetches it back from a relay; send() starts that sync. Watch
   * for the "envelope" event with this uuid.
   */
  async send(
    recipientPublicKeyHex,
    plaintext,
    {
      contentType = defaultContentType(plaintext),
    } = {}
  ) {

    this.#assertRunning();

    insist(recipientPublicKeyHex, "string");

    if (!(
      typeof plaintext === "string" ||
      plaintext instanceof Uint8Array
    )) {
      throw new TypeError(
        "plaintext must be string or Uint8Array"
      );
    }

    const recipient =
      await PublicIdentity.fromPublicHex(
        recipientPublicKeyHex
      );

    const envelopeBytes =
      await encrypt({
        sender: this.identity,
        recipient,
        plaintext,
        contentType,
      });

    const { delivered, failed } =
      await this.#dispatch(envelopeBytes);

    if (delivered.length === 0) {
      throw new DispatchError(failed);
    }

    void this.sync();

    const uuid = bytesToHex(
      Serializer.unpack(envelopeBytes).uuid
    );

    return { uuid, delivered, failed };
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

    const conversations = await this.storage.conversationsGet(options);

    return conversations.sort(
      (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
    );
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

    insist(conversation.publicKeyHex, "string");

    const [existing] =
      await this.storage.conversationsGet({
        publicKeyHex: conversation.publicKeyHex,
      });

    const key = await this.storage.conversationsPut(conversation);

    this.eventBus.publish({
      type: EventTypes.CONVERSATION,
      conversation,
      created: !existing,
    });

    return key;
  }

  // =====================================================
  // Relays
  // =====================================================

  /**
   * options: {} | { relayUrl }
   */
  async relaysGet(options = {}) {

    this.#assertRunning();

    return this.storage.relaysGet(options);
  }

  /**
   * Insert or replace a relay, keyed by relayUrl.
   * Replacing drops sync state (cursor, failure counts) unless the
   * record passed in carries it, as one from relaysGet does.
   */
  async relaysPut(relay) {

    this.#assertRunning();

    insist(relay.relayUrl, "string");
    insist(relay.relayType, "string");
    insist(relay.relayPkh, "string");

    const key = await this.storage.relaysPut(relay);

    this.eventBus.publish({
      type: EventTypes.RELAY,
      relay,
      deleted: false,
    });

    void this.sync();

    return key;
  }

  /**
   * options: { relayUrl }
   * Returns the number of relays removed (0 or 1).
   */
  async relaysDelete({ relayUrl }) {

    this.#assertRunning();

    insist(relayUrl, "string");

    const [relay] = await this.storage.relaysGet({ relayUrl });

    if (!relay) {
      return 0;
    }

    const count = await this.storage.relaysDelete({ relayUrl });

    this.eventBus.publish({
      type: EventTypes.RELAY,
      relay,
      deleted: true,
    });

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

  async #syncLoop() {

    do {
      this.syncAgain = false;
      await this.#performSync();
    } while (
      this.syncAgain &&
      this.status === ClientStatus.RUNNING
    );
  }

  async #performSync() {

    this.eventBus.publish({
      type: EventTypes.SYNC,
      phase: "start",
    });

    try {
      const relays = await this.storage.relaysGet();
      await this.syncEngine.syncRelays(relays);
    }
    catch (error) {
      this.logger.error("Sync failed", error);

      this.eventBus.publish({
        type: EventTypes.ERROR,
        error,
      });
    }
    finally {
      this.eventBus.publish({
        type: EventTypes.SYNC,
        phase: "end",
      });
    }
  }

  /**
   * Older versions disabled a relay after 3 failures in a row, for
   * good. Sync now backs off instead and only the user sets disabled.
   * Re-enable relays that look disabled by sync (disabled with more
   * than 2 failures) so they get retried.
   */
  async #resetSyncDisabledRelays() {

    const relays = await this.storage.relaysGet();

    for (const relay of relays) {

      if (!(relay.disabled && relay.failureCount > 2)) {
        continue;
      }

      const reset = { ...relay, disabled: false, failureCount: 0 };

      await this.storage.relaysPut(reset);

      this.eventBus.publish({
        type: EventTypes.RELAY,
        relay: reset,
        deleted: false,
      });
    }
  }

  async #dispatch(envelopeBytes) {

    const relays = (await this.storage.relaysGet())
      .filter(relay => !relay.disabled);

    const results = await Promise.allSettled(
      relays.map(
        relay => this.#dispatchToRelay(relay, envelopeBytes)
      )
    );

    const delivered = [];
    const failed = [];

    results.forEach((result, i) => {

      const relayUrl = relays[i].relayUrl;

      if (result.status === "fulfilled") {
        delivered.push(relayUrl);
      }
      else {
        failed.push({ relayUrl, error: result.reason });
      }
    });

    this.logger.info("Dispatch:", { delivered, failed });

    return { delivered, failed };
  }

  async #dispatchToRelay(relay, envelopeBytes) {

    const rateLimiter = this.rateLimits.for(relay.relayUrl);

    // Fail fast rather than hold send() for a relay's Retry-After.
    if (rateLimiter.isPaused()) {
      throw new Error(`Relay asked to wait: ${relay.relayUrl}`);
    }

    await rateLimiter.acquire();

    const response =
      await this.transporter.transport({
        url: RequestBuilder.urlEnvelopesPost(relay),
        options: RequestBuilder.optionsEnvelopesPost(envelopeBytes),
        logger: this.logger,
      });

    if (response.status === 429) {
      rateLimiter.pause(
        this.clock.now() + retryAfterMs(response.headers, this.clock.now())
      );
    }

    if (response.status !== 200) {
      throw new Error(`Relay dispatch failed: ${response.status}`);
    }
  }

}

function defaultContentType(plaintext) {
  return typeof plaintext === "string"
    ? ContentTypes.TEXT_UTF8
    : ContentTypes.UNKNOWN;
}
