import {
    insist,
    PrivateIdentity,
    readEnvelope,
    decryptEnvelope,
    envelopeHash,
} from "../../../smep/src/index.js";
import { RealClock } from "../lib/clock.js";

export const MAX_CONVERSATION_NAME = 64;

export class Ingestor {

    constructor({
        identity,
        storage,
        logger,
        clock = RealClock,
        onEnvelope = () => {},
        onConversation = () => {},
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
        this.queue = Promise.resolve();
    }

    ingest(frames, relayUrl = null) {
        return this.enqueue(() => this.ingestBatch(frames, relayUrl));
    }

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

    rename(publicKeyHex, name) {

        insist(publicKeyHex, "string");
        insist(name, "string");

        const label = [...name.trim()].slice(0, MAX_CONVERSATION_NAME).join("").trim();

        return this.enqueue(async () => {

            const [existing] = await this.storage.conversationsGet({ publicKeyHex });

            if (!existing) {
                return null;
            }

            const { name: _previous, ...rest } = existing;
            const conversation = label ? { ...rest, name: label } : rest;

            await this.storage.conversationsPut(conversation);

            this.onConversation(conversation, false);

            return conversation;
        });
    }

    enqueue(task) {

        const run = this.queue.then(task);

        this.queue = run.catch(() => {});

        return run;
    }

    async ingestBatch(frames, relayUrl) {

        this.publicKeyHex ??= await this.identity.exportPublicHex();

        let stored = 0;

        for (const bytes of frames) {
            if (await this.ingestFrame(bytes, relayUrl)) {
                stored += 1;
            }
        }

        this.logger.debug("ingested", { relayUrl, frames: frames.length, stored });
    }

    async ingestFrame(bytes, relayUrl) {
        const hash = await envelopeHash(bytes);

        if (await this.isStored(hash)) {
            return false;
        }

        let decrypted;

        try {
            const envelope = readEnvelope(bytes);
            decrypted = await decryptEnvelope({ identity: this.identity, envelope });
        }
        catch (error) {
            this.reject(hash, error, relayUrl);
            return false;
        }

        const record = this.toRecord(hash, decrypted);

        await this.storage.envelopesPut(record);

        const { conversation, created } = await this.updateConversation(record);

        this.onEnvelope(record);
        this.onConversation(conversation, created);

        return true;
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
                (record.recipientPublicKeyHex === this.publicKeyHex ? 1 : 0),
            lastMessageAt: Math.max(existing?.lastMessageAt ?? 0, record.sentAt),
            ...(record.direction === "inbound" && { hasInbound: true }),
        };

        await this.storage.conversationsPut(conversation);

        return { conversation, created: !existing };
    }

    reject(hash, error, relayUrl) {

        this.logger.warn("envelope rejected", { hash, relayUrl, reason: error.message });

        this.onRejected({ hash, reason: error.message, relayUrl });
    }
}
