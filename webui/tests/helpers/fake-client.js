import { StorageMemory } from "../../../smerp/src/storage/storage-memory.js";

export const PEER = "bb".repeat(32);

export class FakeClient {

    constructor({ publicKeyHex = "aa".repeat(32) } = {}) {

        this.publicKeyHex = publicKeyHex;
        this.ntfyUrl = "https://ntfy.sh";
        this.status = "running";
        this.storage = new StorageMemory();
        this.calls = [];
        this.listeners = new Map();

        this.sendError = null;
        this.sendResult = { hash: "u".repeat(64), delivered: ["http://a.test"], failed: [] };
    }

    record(name, ...args) {
        this.calls.push([name, ...args]);
    }

    callsTo(name) {
        return this.calls.filter(([called]) => called === name).map(([, ...args]) => args);
    }

    on(type, callback) {

        this.record("on", type);

        const set = this.listeners.get(type) ?? new Set();
        set.add(callback);
        this.listeners.set(type, set);

        return () => set.delete(callback);
    }

    emit(event) {
        for (const callback of this.listeners.get(event.type) ?? []) {
            callback(event);
        }
    }

    listenerCount() {
        return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    }

    async start() { this.record("start"); this.status = "running"; }

    async stop() { this.record("stop"); this.status = "stopped"; }

    sync() {
        this.record("sync");
        return Promise.resolve();
    }

    async send(recipientPublicKeyHex, plaintext, options) {

        this.record("send", recipientPublicKeyHex, plaintext, options);

        if (this.sendError) {
            throw this.sendError;
        }

        return this.sendResult;
    }

    async envelopesGet(options = {}) {
        this.record("envelopesGet", options);
        return this.storage.envelopesGet(options);
    }

    async conversationsGet(options = {}) {
        this.record("conversationsGet", options);
        const conversations = await this.storage.conversationsGet(options);
        return conversations.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
    }

    async markRead(publicKeyHex) {

        this.record("markRead", publicKeyHex);

        const [existing] = await this.storage.conversationsGet({ publicKeyHex });

        if (!existing || existing.unreadCount === 0) {
            return null;
        }

        const conversation = { ...existing, unreadCount: 0 };
        await this.storage.conversationsPut(conversation);

        return conversation;
    }

    async renameConversation(publicKeyHex, name) {

        this.record("renameConversation", publicKeyHex, name);

        const [existing] = await this.storage.conversationsGet({ publicKeyHex });

        if (!existing) {
            return null;
        }

        const { name: _previous, ...rest } = existing;
        const label = name.trim();
        const conversation = label ? { ...rest, name: label } : rest;
        await this.storage.conversationsPut(conversation);

        return conversation;
    }

    async notifyTopic(publicKeyHex) {
        this.record("notifyTopic", publicKeyHex);
        return `raven-${publicKeyHex.slice(0, 32)}`;
    }

    async relaysGet(options = {}) {
        this.record("relaysGet", options);
        return this.storage.relaysGet(options);
    }

    async relaysPut(relay) {
        this.record("relaysPut", relay);
        return this.storage.relaysPut(relay);
    }

    async relaysDelete(options) {
        this.record("relaysDelete", options);
        return this.storage.relaysDelete(options);
    }
}

export function envelope({
    hash,
    peer = PEER,
    plaintext = `text ${hash}`,
    contentType = 1,
    direction = "inbound",
    sentAt = 1_000_000,
    receivedAt = sentAt,
}) {

    return {
        hash,
        contentType,
        plaintext,
        senderPublicKeyHex: direction === "inbound" ? peer : "aa".repeat(32),
        recipientPublicKeyHex: direction === "inbound" ? "aa".repeat(32) : peer,
        publicKeyHex: peer,
        direction,
        sentAt,
        receivedAt,
    };
}
