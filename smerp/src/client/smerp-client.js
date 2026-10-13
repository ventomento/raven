// src/client/smerp-client.js

import {
    PrivateIdentity,
    PublicIdentity,
    encrypt,
    readEnvelope,
    bytesToHex,
} from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { ContentTypes } from "../../../smep/src/envelope/content-types.js";
import { StorageMemory } from "../storage/storage-memory.js";
import { TransportDefault } from "../transport/transport-default.js";
import { LightLog } from "../log/light-log.js";
import { RealClock } from "../lib/clock.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { Scheduler } from "../sync/scheduler.js";
import { RelaySession } from "../session/relay-session.js";
import { Ingestor } from "../ingest/ingestor.js";
import { NotStartedError, DispatchError } from "./errors.js";

export const ClientStatus = Object.freeze({
    STOPPED: "stopped",
    STARTING: "starting",
    RUNNING: "running",
    STOPPING: "stopping",
});

// Relay record fields written by sessions (RelaySession.state()). A user's
// relaysPut keeps them unless it sets them itself.
const SYNC_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastSuccessAt",
    "lastFailureAt",
    "lastFailureReason",
]);

// Sync fields worth a RELAY event. lastSuccessAt changes on every
// successful request, so it alone is not.
const NOTIFY_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastFailureReason",
]);

/**
 * Reference smerp client. Headless: a UI reads local data through the
 * get methods, acts through send/markRead/relays*, and reacts to events
 * subscribed with on().
 *
 * Built from three modules:
 *
 *   Scheduler     (sync/)     runs the relay sessions' sync steps, N at a time
 *   RelaySession  (session/)  one per enabled relay: fetches, posts, owns its state
 *   Ingestor      (ingest/)   stores fetched envelopes and their conversations
 *
 * Every envelope enters storage through the Ingestor, after a sync
 * fetched it, our own sent ones included: an envelope counts as sent once
 * a relay accepted it and it could be downloaded back.
 *
 * Relay changes stop the scheduler, write, and build new sessions and a
 * new scheduler. Sessions only save during steps and posts, so their
 * saves cannot interleave with the user's relay writes.
 */
export class SmerpClient {

    constructor({
        identity,
        transporter = TransportDefault,
        storage = new StorageMemory(),
        logger = new LightLog(),
        clock = RealClock,
        syncIntervalMs = 60 * 1000,
        // Sync requests in flight at once, over all relays.
        concurrency = Scheduler.DEFAULTS.concurrency,
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.transporter = transporter;
        this.storage = storage;
        this.logger = logger;
        this.clock = clock;
        this.syncIntervalMs = syncIntervalMs;
        this.concurrency = concurrency;

        this.eventBus = new EventBus();
        this.status = ClientStatus.STOPPED;
        this.publicKeyHex = null;

        this.ingestor = null;
        this.scheduler = null;
        this.sessions = new Map();          // relayUrl -> RelaySession, enabled relays
        this.syncing = null;                // promise of the sync in progress
        this.relayChanges = Promise.resolve();
        this.syncIntervalId = null;
    }

    // =====================================================
    // Lifecycle
    // =====================================================

    async start() {

        if (this.status !== ClientStatus.STOPPED) {
            return;
        }

        this.setStatus(ClientStatus.STARTING);

        try {

            await this.storage.init();

            this.publicKeyHex =
                this.identity.publicKeyHex ??
                await this.identity.exportPublicHex();

            this.ingestor = new Ingestor({
                identity: this.identity,
                storage: this.storage,
                logger: this.logger,
                clock: this.clock,
                onEnvelope: envelope =>
                    this.publish({ type: EventTypes.ENVELOPE, envelope }),
                onConversation: (conversation, created) =>
                    this.publish({ type: EventTypes.CONVERSATION, conversation, created }),
                onRejected: ({ uuid, reason, relayUrl }) =>
                    this.publish({ type: EventTypes.REJECTED, uuid, reason, relayUrl }),
            });

            await this.buildSessions();
        }
        catch (error) {
            this.ingestor = null;
            await this.storage.close();
            this.setStatus(ClientStatus.STOPPED);
            throw error;
        }

        this.setStatus(ClientStatus.RUNNING);

        void this.sync();

        this.syncIntervalId = setInterval(() => void this.sync(), this.syncIntervalMs);
    }

    async stop() {

        if (this.status !== ClientStatus.RUNNING) {
            return;
        }

        this.setStatus(ClientStatus.STOPPING);

        clearInterval(this.syncIntervalId);
        this.syncIntervalId = null;

        await this.relayChanges;
        await this.scheduler.stop();
        await this.storage.close();

        this.scheduler = null;
        this.sessions = new Map();
        this.ingestor = null;

        this.setStatus(ClientStatus.STOPPED);
    }

    // =====================================================
    // Sync and send
    // =====================================================

    /**
     * Sync all enabled relays now. Resolves when the sync is done: no
     * relay has more to fetch right now (failing and throttled relays
     * wait for a later sync). Publishes SYNC start and end. Never rejects.
     */
    sync() {

        this.assertRunning();

        const done = this.scheduler.wake();

        if (!this.syncing) {

            this.publish({ type: EventTypes.SYNC, phase: "start" });

            this.syncing = done.then(() => {
                this.syncing = null;
                this.publish({ type: EventTypes.SYNC, phase: "end" });
            });
        }

        return this.syncing;
    }

    /**
     * Encrypt plaintext for a recipient and upload it to every enabled
     * relay at once.
     *
     * plaintext: string | Uint8Array. contentType defaults to TEXT_UTF8
     * for strings, UNKNOWN for bytes. The envelope may be at most 4 MiB.
     *
     * Resolves with { uuid, delivered, failed } once at least one relay
     * accepted it; throws DispatchError if none did. Nothing is stored
     * here: the envelope is stored when sync downloads it back (started
     * here); watch for the ENVELOPE event with this uuid.
     */
    async send(recipientPublicKeyHex, plaintext, { contentType = defaultContentType(plaintext) } = {}) {

        this.assertRunning();

        insist(recipientPublicKeyHex, "string");

        if (!(typeof plaintext === "string" || plaintext instanceof Uint8Array)) {
            throw new TypeError("plaintext must be string or Uint8Array");
        }

        const recipient = await PublicIdentity.fromPublicHex(recipientPublicKeyHex);

        const envelopeBytes = await encrypt({
            sender: this.identity,
            recipient,
            plaintext,
            contentType,
        });

        const sessions = [...this.sessions.values()];

        const results = await Promise.allSettled(
            sessions.map(session => session.post(envelopeBytes))
        );

        const delivered = [];
        const failed = [];

        results.forEach((result, i) => {

            const { relayUrl } = sessions[i];

            if (result.status === "fulfilled") {
                delivered.push(relayUrl);
            }
            else {
                failed.push({ relayUrl, error: result.reason });
            }
        });

        this.logger.info("Send:", { delivered, failed });

        if (delivered.length === 0) {
            throw new DispatchError(failed);
        }

        void this.sync();

        return {
            uuid: bytesToHex(readEnvelope(envelopeBytes).uuid),
            delivered,
            failed,
        };
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
    // Envelopes and conversations
    // =====================================================

    /**
     * options: {} | { uuid } | { publicKeyHex, beforeSentAt?, beforeReceivedAt?, limit? }
     * Sorted newest first (sentAt, then receivedAt). To page, pass the
     * sentAt and receivedAt of the previous page's last envelope.
     */
    async envelopesGet(options = {}) {

        this.assertRunning();

        return this.storage.envelopesGet(options);
    }

    /**
     * options: {} | { publicKeyHex }
     * Sorted by lastMessageAt, newest first.
     */
    async conversationsGet(options = {}) {

        this.assertRunning();

        const conversations = await this.storage.conversationsGet(options);

        return conversations.sort(
            (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
        );
    }

    /**
     * Reset a conversation's unreadCount. Runs in line with ingestion, so
     * an envelope arriving at the same time is never lost from the count.
     * Resolves with the conversation, or null if nothing was unread.
     */
    async markRead(publicKeyHex) {

        this.assertRunning();

        return this.ingestor.markRead(publicKeyHex);
    }

    // =====================================================
    // Relays
    // =====================================================

    /**
     * options: {} | { relayUrl }
     */
    async relaysGet(options = {}) {

        this.assertRunning();

        return this.storage.relaysGet(options);
    }

    /**
     * Insert or replace a relay, keyed by relayUrl.
     *
     *   { relayUrl, relayType, relayToken?, disabled? }
     *
     * relayToken is an access token from the relay's operator, sent as a
     * bearer token on every request to that relay. Sync fields (cursor,
     * relayPkh, health) are kept from the stored record unless given.
     * Resolves with the relayUrl once its sessions are rebuilt.
     */
    async relaysPut(relay) {

        this.assertRunning();

        insist(relay.relayUrl, "string");
        insist(relay.relayType, "string");

        if (relay.relayToken != null) {
            insist(relay.relayToken, "string");
        }

        return this.changeRelays(async () => {

            const [existing] = await this.storage.relaysGet({ relayUrl: relay.relayUrl });

            const stored = { ...pick(existing, SYNC_FIELDS), ...relay };

            await this.storage.relaysPut(stored);

            this.publish({ type: EventTypes.RELAY, relay: stored, deleted: false });

            return stored.relayUrl;
        });
    }

    /**
     * options: { relayUrl }
     * Resolves with the number of relays removed (0 or 1).
     */
    async relaysDelete({ relayUrl }) {

        this.assertRunning();

        insist(relayUrl, "string");

        return this.changeRelays(async () => {

            const [existing] = await this.storage.relaysGet({ relayUrl });

            if (!existing) {
                return 0;
            }

            await this.storage.relaysDelete({ relayUrl });

            this.publish({ type: EventTypes.RELAY, relay: existing, deleted: true });

            return 1;
        });
    }

    // =====================================================
    // Internal
    // =====================================================

    /**
     * Run write (a relay write) with the scheduler stopped, then rebuild
     * sessions and scheduler and sync. Changes run one at a time, so two
     * changes cannot interleave their stop and rebuild.
     */
    changeRelays(write) {

        const run = this.relayChanges.then(async () => {

            // Running steps finish and save first.
            await this.scheduler.stop();

            // From here a late save (from a post) of an old session is ignored.
            this.sessions = new Map();

            const result = await write();

            await this.buildSessions();

            void this.sync();

            return result;
        });

        this.relayChanges = run.catch(() => {});

        return run;
    }

    // A session per enabled relay, all added to a new scheduler.
    async buildSessions() {

        this.scheduler = new Scheduler({
            concurrency: this.concurrency,
            clock: this.clock,
            onError: (error, session) => {
                this.logger.warn("Sync step failed:", session.relayUrl, error.message);
                this.publish({ type: EventTypes.ERROR, error, relayUrl: session.relayUrl });
            },
        });

        const sessions = new Map();

        for (const relay of await this.storage.relaysGet()) {

            if (relay.disabled) {
                continue;
            }

            const session = new RelaySession({
                relay,
                identity: this.identity,
                transporter: this.transporter,
                logger: this.logger,
                clock: this.clock,
                consume: frames => this.ingestor.ingest(frames, relay.relayUrl),
                save: state => this.saveRelayState(session, state),
            });

            sessions.set(relay.relayUrl, session);
            this.scheduler.add(session);
        }

        this.sessions = sessions;
    }

    /**
     * Merge a session's state onto its stored relay record. Ignored for a
     * session that is no longer current (replaced by a relay change) and
     * for a relay that was deleted, so neither can write over the newer
     * record or bring a deleted relay back.
     */
    async saveRelayState(session, state) {

        if (this.sessions.get(session.relayUrl) !== session) {
            return;
        }

        const [stored] = await this.storage.relaysGet({ relayUrl: session.relayUrl });

        if (!stored) {
            return;
        }

        const relay = { ...stored, ...state };

        await this.storage.relaysPut(relay);

        if (NOTIFY_FIELDS.some(field => relay[field] !== stored[field])) {
            this.publish({ type: EventTypes.RELAY, relay, deleted: false });
        }

        // A new failure is also reported as an error, for the UI's status line.
        if (relay.failureCount > (stored.failureCount ?? 0)) {
            this.publish({
                type: EventTypes.ERROR,
                error: new Error(relay.lastFailureReason ?? "relay failure"),
                relayUrl: relay.relayUrl,
            });
        }
    }

    assertRunning() {

        if (this.status !== ClientStatus.RUNNING) {
            throw new NotStartedError();
        }
    }

    setStatus(status) {

        this.status = status;

        this.publish({ type: EventTypes.STATUS, status });
    }

    publish(event) {
        this.eventBus.publish(event);
    }
}

function defaultContentType(plaintext) {

    return typeof plaintext === "string"
        ? ContentTypes.TEXT_UTF8
        : ContentTypes.UNKNOWN;
}

// The given fields of record that are set, as a new object.
function pick(record, fields) {

    const picked = {};

    for (const field of fields) {
        if (record?.[field] !== undefined) {
            picked[field] = record[field];
        }
    }

    return picked;
}
