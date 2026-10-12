import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { ConcurrencyLimiter } from "../lib/concurrency-limiter.js";
import { RealClock } from "../lib/clock.js";

/**
 * Envelopes and conversations: the only module that writes them, and the
 * one that publishes ENVELOPE and CONVERSATION for every write.
 *
 * Times in stored records are milliseconds since epoch, named ...At.
 */
export class MessageStore {

    constructor({
        storage,
        eventBus,
        logger,
        clock = RealClock,
    }) {

        insist(storage);
        insist(eventBus, EventBus);
        insist(logger);

        this.storage = storage;
        this.eventBus = eventBus;
        this.logger = logger;
        this.clock = clock;
        // Last receivedAt handed out; see storeIfNew.
        this.lastReceivedAt = 0;
        // Serializes dedup check + persist. Relays are synced in parallel and
        // every envelope is on every relay, so the same envelope can be
        // stored twice at once; without this both copies pass the dedup
        // check and the envelope is announced and unread-counted twice.
        this.writeLock = new ConcurrencyLimiter(1);
    }

    // =====================================================
    // Envelopes
    // =====================================================

    async has(uuid) {

        const existing = await this.storage.envelopesGet({ uuid, limit: 1 });

        return existing.length > 0;
    }

    /**
     * Store an opened envelope record unless its uuid is already stored,
     * and update its conversation. Returns the stored record, or null for
     * a duplicate. Storage errors propagate.
     *
     * receivedAt is assigned here and is strictly increasing per client,
     * so it orders envelopes that share a sentAt second in the order they
     * were stored.
     */
    async storeIfNew(record) {

        const stored = await this.writeLock.run(async () => {

            if (await this.has(record.uuid)) {
                return null;
            }

            this.lastReceivedAt = Math.max(this.clock.now(), this.lastReceivedAt + 1);

            const envelope = { ...record, receivedAt: this.lastReceivedAt };

            await this.storage.envelopesPut(envelope);

            this.logger.info("MessageStore: envelope stored:", { uuid: envelope.uuid });

            await this.#updateConversation(envelope);

            return envelope;
        });

        if (stored) {
            this.eventBus.publish({ type: EventTypes.ENVELOPE, envelope: stored });
        }

        return stored;
    }

    /**
     * options: {} | { uuid } | { publicKeyHex, beforeSentAt?, beforeReceivedAt?, limit? }
     * Sorted newest first (sentAt, then receivedAt).
     */
    envelopesGet(options = {}) {
        return this.storage.envelopesGet(options);
    }

    // =====================================================
    // Conversations
    // =====================================================

    /**
     * options: {} | { publicKeyHex }
     * Sorted by lastMessageAt, newest first.
     */
    async conversationsGet(options = {}) {

        const conversations = await this.storage.conversationsGet(options);

        return conversations.sort(
            (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
        );
    }

    /**
     * Insert or replace a conversation. Last write wins: an envelope stored
     * between a caller's get and put has its unread increment overwritten.
     */
    async conversationsPut(conversation) {

        insist(conversation.publicKeyHex, "string");

        const [existing] = await this.storage.conversationsGet({
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

    async #updateConversation(envelope) {

        const publicKeyHex = envelope.publicKeyHex;

        const [existing] = await this.storage.conversationsGet({
            publicKeyHex,
            limit: 1,
        });

        const conversation = {
            ...(existing ?? {}),

            publicKeyHex,

            unreadCount:
                (existing?.unreadCount ?? 0) +
                (envelope.direction === "outbound" ? 0 : 1),

            lastMessageAt:
                existing && existing.lastMessageAt > envelope.sentAt
                    ? existing.lastMessageAt
                    : envelope.sentAt,
        };

        await this.storage.conversationsPut(conversation);

        this.eventBus.publish({
            type: EventTypes.CONVERSATION,
            conversation,
            created: !existing,
        });
    }
}
