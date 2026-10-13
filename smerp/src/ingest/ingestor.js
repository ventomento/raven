import {
    insist,
    PrivateIdentity,
    readEnvelope,
    decryptEnvelope,
    envelopeHash,
} from "../../../smep/src/index.js";
import { RealClock } from "../lib/clock.js";

/**
 * Turns the envelopes of a relay batch into stored records: the consume
 * of RelaySession (session/relay-session.js). Shared by all sessions.
 *
 * Per frame, in batch order:
 *
 *   hash       envelopeHash (sha256 of the bytes)
 *   dedup      hash already stored            → skipped
 *   parse      readEnvelope                   throws → rejected, skipped
 *   decrypt    decryptEnvelope                throws → rejected, skipped
 *   store      envelopesPut                   throws → propagates
 *   convo      conversationsPut               throws → propagates
 *   notify     onEnvelope, onConversation
 *
 * A rejected envelope is a problem with the envelope: retrying gives the
 * same result, so the batch goes on and the session's cursor moves past
 * it. A storage error is local: it propagates, the session keeps its
 * cursor and fetches the batch again later; dedup makes that safe.
 *
 * Batches are ingested one at a time. Sessions run in parallel and every
 * relay holds the same envelopes; if batches interleaved, two could both
 * pass the dedup check for one envelope (announced and counted unread
 * twice), or both read a conversation and write it back (an unread
 * increment lost). markRead runs in the same line, so it cannot lose a
 * concurrent increment either.
 *
 * Stored envelope:
 *
 *   { hash,                         hex sha256 of the envelope bytes
 *     contentType, plaintext,
 *     senderPublicKeyHex, recipientPublicKeyHex,
 *     publicKeyHex,                 the peer: recipient if we sent it, else sender
 *     direction,                    "inbound" | "outbound"
 *     sentAt,                       wire timestamp (seconds) as ms
 *     receivedAt }                  strictly increasing; orders same-second envelopes
 *
 * Stored conversation:
 *
 *   { publicKeyHex, unreadCount, lastMessageAt }
 *
 * Our own sent envelopes come back through sync as "outbound" and are not
 * counted unread.
 */
export class Ingestor {

    constructor({
        identity,
        storage,
        logger,
        clock = RealClock,
        // (envelope) after it is stored
        onEnvelope = () => {},
        // (conversation, created) after it is stored
        onConversation = () => {},
        // ({ hash, reason, relayUrl }) for a skipped envelope
        onRejected = () => {},
    }) {

        insist(identity, PrivateIdentity);
        insist(storage);
        insist(logger);
        insist(onEnvelope, "function");
        insist(onConversation, "function");
        insist(onRejected, "function");

        this.identity = identity;
        this.storage = storage;
        this.logger = logger;
        this.clock = clock;
        this.onEnvelope = onEnvelope;
        this.onConversation = onConversation;
        this.onRejected = onRejected;

        this.publicKeyHex = identity.publicKeyHex ?? null;
        this.lastReceivedAt = 0;
        this.queue = Promise.resolve();   // tail of the tasks in line
    }

    /**
     * Ingest a batch once the batches before it are done. frames: the
     * envelopes, each an ArrayBuffer. relayUrl is only reported with
     * rejections. Rejects on a storage error.
     */
    ingest(frames, relayUrl = null) {
        return this.enqueue(() => this.ingestBatch(frames, relayUrl));
    }

    /**
     * Reset a conversation's unreadCount to 0. Resolves with the stored
     * conversation, or null if there is none or nothing was unread.
     */
    markRead(publicKeyHex) {

        insist(publicKeyHex, "string");

        return this.enqueue(async () => {

            const [existing] = await this.storage.conversationsGet({ publicKeyHex });

            if (!existing || existing.unreadCount === 0) {
                return null;
            }

            const conversation = { ...existing, unreadCount: 0 };

            await this.storage.conversationsPut(conversation);

            this.onConversation(conversation, false);

            return conversation;
        });
    }

    // =====================================================
    // Internal
    // =====================================================

    // Run task once the tasks before it are done.
    enqueue(task) {

        const run = this.queue.then(task);

        // A failed task must not block the ones after it; its caller
        // still gets the error through run.
        this.queue = run.catch(() => {});

        return run;
    }

    async ingestBatch(frames, relayUrl) {

        this.publicKeyHex ??= await this.identity.exportPublicHex();

        for (const bytes of frames) {
            await this.ingestFrame(bytes, relayUrl);
        }
    }

    async ingestFrame(bytes, relayUrl) {

        // The hash is computed from the bytes, never read from the header, so
        // another envelope cannot claim it and get the real one skipped.
        const hash = await envelopeHash(bytes);

        if (await this.isStored(hash)) {
            return;
        }

        let decrypted;

        try {
            const envelope = readEnvelope(bytes);
            decrypted = await decryptEnvelope({ identity: this.identity, envelope });
        }
        catch (error) {
            this.reject(hash, error, relayUrl);
            return;
        }

        const record = this.toRecord(hash, decrypted);

        await this.storage.envelopesPut(record);

        const { conversation, created } = await this.updateConversation(record);

        this.onEnvelope(record);
        this.onConversation(conversation, created);
    }

    async isStored(hash) {

        const existing = await this.storage.envelopesGet({ hash, limit: 1 });

        return existing.length > 0;
    }

    toRecord(hash, { timestamp, ...decrypted }) {

        const outbound = decrypted.senderPublicKeyHex === this.publicKeyHex;

        this.lastReceivedAt = Math.max(this.clock.now(), this.lastReceivedAt + 1);

        return {
            hash,
            ...decrypted,
            publicKeyHex: outbound
                ? decrypted.recipientPublicKeyHex
                : decrypted.senderPublicKeyHex,
            direction: outbound ? "outbound" : "inbound",
            sentAt: timestamp * 1000,
            receivedAt: this.lastReceivedAt,
        };
    }

    async updateConversation(record) {

        const { publicKeyHex } = record;

        const [existing] = await this.storage.conversationsGet({ publicKeyHex });

        const conversation = {
            ...existing,
            publicKeyHex,
            unreadCount:
                (existing?.unreadCount ?? 0) +
                (record.direction === "inbound" ? 1 : 0),
            lastMessageAt: Math.max(existing?.lastMessageAt ?? 0, record.sentAt),
        };

        await this.storage.conversationsPut(conversation);

        return { conversation, created: !existing };
    }

    reject(hash, error, relayUrl) {

        this.logger.warn("Envelope rejected:", { hash, relayUrl, reason: error.message });

        this.onRejected({ hash, reason: error.message, relayUrl });
    }
}
