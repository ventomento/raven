import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { EnvelopeOpener } from "./envelope-opener.js";
import { MessageStore } from "../state/message-store.js";

export const IngestOutcome = Object.freeze({
    STORED: "stored",          // new envelope, persisted and announced
    DUPLICATE: "duplicate",    // already stored
    REJECTED: "rejected",      // malformed or undecryptable, never will be
});

/**
 * Turns envelope bytes from a relay into stored records. The single
 * ingestion path: every envelope, including our own sent ones, is
 * stored through here.
 *
 * A failure is classified by the stage it happens in, not by its type:
 *   - anything thrown while opening (EnvelopeOpener) is a problem with
 *     the envelope: it is REJECTED, REJECTED is published, and the batch
 *     goes on. The caller moves past it.
 *   - anything thrown by MessageStore is a problem with the environment
 *     (storage): it propagates, so the caller keeps its cursor and
 *     fetches the batch again later. Dedup makes that safe.
 */
export class Ingestor {

    constructor({ opener, store, eventBus, logger }) {

        insist(opener, EnvelopeOpener);
        insist(store, MessageStore);
        insist(eventBus, EventBus);
        insist(logger);

        this.opener = opener;
        this.store = store;
        this.eventBus = eventBus;
        this.logger = logger;
    }

    /**
     * Ingest a batch in order. source { relayUrl, cursor } is reported on
     * REJECTED events. Returns the outcome counts.
     */
    async ingestBatch(frames, source = {}) {

        const counts = { stored: 0, duplicate: 0, rejected: 0 };

        for (const bytes of frames) {
            const { outcome } = await this.ingest(bytes, source);
            counts[outcome]++;
        }

        return counts;
    }

    /**
     * Resolves with { outcome, uuid, envelope?, reason? }.
     */
    async ingest(bytes, source = {}) {

        let read;

        try {
            read = this.opener.read(bytes);
        }
        catch (error) {
            return this.#rejected(null, error, source);
        }

        const { uuid } = read;

        // Fast path, outside the store's lock: most duplicates end here.
        if (await this.store.has(uuid)) {
            return { outcome: IngestOutcome.DUPLICATE, uuid };
        }

        let record;

        try {
            record = await this.opener.open(read.envelope);
        }
        catch (error) {
            return this.#rejected(uuid, error, source);
        }

        const envelope = await this.store.storeIfNew(record);

        return envelope
            ? { outcome: IngestOutcome.STORED, uuid, envelope }
            : { outcome: IngestOutcome.DUPLICATE, uuid };
    }

    #rejected(uuid, error, { relayUrl, cursor }) {

        this.logger.warn("Ingestor: envelope rejected:", { uuid, reason: error.message });

        this.eventBus.publish({
            type: EventTypes.REJECTED,
            relayUrl,
            cursor,
            uuid,
            reason: error.message,
        });

        return { outcome: IngestOutcome.REJECTED, uuid, reason: error.message };
    }
}
