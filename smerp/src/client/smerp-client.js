import {
    PrivateIdentity,
    PublicIdentity,
    encrypt,
    envelopeHash,
    notifyTopic,
} from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { ContentTypes } from "../../../smep/src/envelope/content-types.js";
import { StorageMemory } from "../storage/storage-memory.js";
import { TransportDefault } from "../transport/transport-default.js";
import { Logger } from "../log/logger.js";
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

const SYNC_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastSuccessAt",
    "lastFailureAt",
    "lastFailureReason",
]);

const NOTIFY_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastFailureReason",
]);

// The phone notification a sender pushes to ntfy (smerp_rfc section 7).
// It says only that something arrived.
const NTFY_PUSH = Object.freeze({
    headers: Object.freeze({ "Title": "raven", "X-Sequence-ID": "raven" }),
    body: "raven: new envelope received",
    timeout: 5000,
    maxBytes: 64 * 1024,
    defaultPauseMs: 60 * 1000,
    cooldownMs: 5 * 60 * 1000,
});

export class SmerpClient {

    constructor({
        identity,
        transporter = TransportDefault,
        storage = new StorageMemory(),
        clock = RealClock,
        debug = false,
        logger = null,
        syncIntervalMs = 60 * 1000,
        concurrency = Scheduler.DEFAULTS.concurrency,
        notify = false,
        ntfyUrl = "https://ntfy.sh",
    }) {

        insist(identity, PrivateIdentity);
        insist(notify, "boolean");

        this.identity = identity;
        this.transporter = transporter;
        this.storage = storage;
        this.logger = logger ?? new Logger({ enabled: debug, clock });
        this.clock = clock;
        this.syncIntervalMs = syncIntervalMs;
        this.concurrency = concurrency;
        this.notify = notify;
        this.ntfyUrl = parseNtfyUrl(ntfyUrl);
        this.ntfyPausedUntil = 0;
        this.ntfyLastPushAt = new Map();

        this.eventBus = new EventBus();
        this.status = ClientStatus.STOPPED;
        this.publicKeyHex = null;

        this.ingestor = null;
        this.scheduler = null;
        this.sessions = new Map();
        this.syncing = null;
        this.relayChanges = Promise.resolve();
        this.syncIntervalId = null;
    }

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
                onRejected: ({ hash, reason, relayUrl }) =>
                    this.publish({ type: EventTypes.REJECTED, hash, reason, relayUrl }),
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

        this.logger.info("started", { publicKeyHex: this.publicKeyHex, relays: this.sessions.size });

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

        this.logger.info("stopped");
    }

    sync() {

        this.assertRunning();

        const done = this.scheduler.wake();

        if (!this.syncing) {

            this.logger.debug("sync start");
            this.publish({ type: EventTypes.SYNC, phase: "start" });

            this.syncing = done.then(() => {
                this.syncing = null;
                this.logger.debug("sync end");
                this.publish({ type: EventTypes.SYNC, phase: "end" });
            });
        }

        return this.syncing;
    }

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

        const hash = await envelopeHash(envelopeBytes);

        this.logger.info("send", {
            hash,
            delivered,
            failed: failed.map(({ relayUrl, error }) => ({ relayUrl, reason: error.message })),
        });

        if (delivered.length === 0) {
            throw new DispatchError(failed);
        }

        void this.sync();
        void this.pushNotification(recipientPublicKeyHex);

        return {
            hash,
            delivered,
            failed,
        };
    }

    // Pushes "something arrived" to the recipient's ntfy topic. Best effort:
    // never awaited by send(), never throws. Only when notify is on, never for
    // a note to self, and only to a peer we have received from (a cold first
    // contact never gets a push), and at most once per cooldown per peer, so an
    // active conversation doesn't buzz on every message. The cooldown starts
    // when a push is tried, failed or not. The topic is a secret: it is never
    // logged.
    async pushNotification(recipientPublicKeyHex) {

        try {

            const recipient = recipientPublicKeyHex.toLowerCase();

            if (!this.notify || recipient === this.publicKeyHex || this.clock.now() < this.ntfyPausedUntil) {
                return;
            }

            const [conversation] = await this.storage.conversationsGet({ publicKeyHex: recipient });

            if (!conversation?.hasInbound) {
                return;
            }

            // No await between this check and the set, so two quick sends can't
            // both pass it.
            const now = this.clock.now();

            if (now - (this.ntfyLastPushAt.get(recipient) ?? -Infinity) < NTFY_PUSH.cooldownMs) {
                return;
            }

            this.ntfyLastPushAt.set(recipient, now);

            const topic = await notifyTopic(this.identity, this.publicKeyHex, recipient);

            const response = await this.transporter.transport({
                url: `${this.ntfyUrl}/${topic}`,
                options: {
                    method: "POST",
                    headers: { ...NTFY_PUSH.headers },
                    body: NTFY_PUSH.body,
                },
                timeout: NTFY_PUSH.timeout,
                maxBytes: NTFY_PUSH.maxBytes,
            });

            if (response.status === 429) {
                const seconds = Number(response.headers?.["retry-after"]);
                const waitMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : NTFY_PUSH.defaultPauseMs;
                this.ntfyPausedUntil = this.clock.now() + waitMs;
                this.logger.warn("ntfy push rate limited", { waitMs });
            }
            else if (response.status !== 200) {
                this.logger.warn("ntfy push refused", { status: response.status });
            }
            else {
                this.logger.debug("ntfy push sent");
            }
        }
        catch (error) {
            this.logger.warn("ntfy push failed", { reason: error.message });
        }
    }

    // The topic a peer's client pushes to when it sends to us: what our phone
    // subscribes to, to get notified for this conversation.
    async notifyTopic(publicKeyHex) {

        this.assertRunning();

        return notifyTopic(this.identity, publicKeyHex, this.publicKeyHex);
    }

    on(eventType, callback) {
        return this.eventBus.subscribe(eventType, callback);
    }

    async envelopesGet(options = {}) {

        this.assertRunning();

        return this.storage.envelopesGet(options);
    }

    async conversationsGet(options = {}) {

        this.assertRunning();

        const conversations = await this.storage.conversationsGet(options);

        return conversations.sort(
            (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
        );
    }

    async markRead(publicKeyHex) {

        this.assertRunning();

        return this.ingestor.markRead(publicKeyHex);
    }

    async renameConversation(publicKeyHex, name) {

        this.assertRunning();

        return this.ingestor.rename(publicKeyHex, name);
    }

    async relaysGet(options = {}) {

        this.assertRunning();

        return this.storage.relaysGet(options);
    }

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

    changeRelays(write) {

        const run = this.relayChanges.then(async () => {
            await this.scheduler.stop();

            this.sessions = new Map();

            try {
                return await write();
            }
            finally {

                await this.buildSessions();

                this.logger.info("relays changed", { relays: this.sessions.size });

                if (this.status === ClientStatus.RUNNING) {
                    void this.sync();
                }
            }
        });

        this.relayChanges = run.catch(() => {});

        return run;
    }

    async buildSessions() {

        this.scheduler = new Scheduler({
            concurrency: this.concurrency,
            clock: this.clock,
            onError: (error, session) => {
                this.logger.warn("sync step failed", { relayUrl: session.relayUrl, reason: error.message });
                this.publish({ type: EventTypes.ERROR, error, relayUrl: session.relayUrl });
            },
            onCapped: session => {
                this.logger.info("sync step budget used", { relayUrl: session.relayUrl });
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
                logger: this.logger.child({ relayUrl: relay.relayUrl }),
                clock: this.clock,
                consume: frames => this.ingestor.ingest(frames, relay.relayUrl),
                save: state => this.saveRelayState(session, state),
            });

            sessions.set(relay.relayUrl, session);
            this.scheduler.add(session);
        }

        this.sessions = sessions;
    }

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

function parseNtfyUrl(ntfyUrl) {

    insist(ntfyUrl, "string");

    const url = new URL(ntfyUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("ntfyUrl must be an http(s) URL");
    }

    return ntfyUrl.trim().replace(/\/+$/, "");
}

function pick(record, fields) {

    const picked = {};

    for (const field of fields) {
        if (record?.[field] !== undefined) {
            picked[field] = record[field];
        }
    }

    return picked;
}
