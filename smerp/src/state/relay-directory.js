import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { ConcurrencyLimiter } from "../lib/concurrency-limiter.js";

// Relay record fields owned by sync. A session writes back only these,
// so a user's put during a sync (disabled, relayToken, ...) is kept.
const SYNC_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastSuccessAt",
    "lastFailureAt",
    "lastFailureReason",
]);

// Sync fields whose change is worth a RELAY event. lastSuccessAt changes
// on every successful request, so it alone is not.
const NOTIFY_FIELDS = Object.freeze([
    "cursor",
    "relayPkh",
    "failureCount",
    "lastFailureReason",
]);

/**
 * Relay records: the only module that writes them, and the one that
 * publishes RELAY for every write.
 *
 * The user owns the config fields (relayUrl, relayType, relayToken,
 * disabled) and writes whole records with put. Relay sessions own the
 * sync fields and merge them in with recordProgress.
 */
export class RelayDirectory {

    constructor({ storage, eventBus }) {

        insist(storage);
        insist(eventBus, EventBus);

        this.storage = storage;
        this.eventBus = eventBus;
        // Serializes every relay write, so a delete cannot land between the
        // get and put of recordProgress and be undone.
        this.writeLock = new ConcurrencyLimiter(1);
    }

    /**
     * options: {} | { relayUrl }
     */
    relaysGet(options = {}) {
        return this.storage.relaysGet(options);
    }

    /**
     * Insert or replace a relay, keyed by relayUrl. relayPkh and
     * relayToken are optional.
     */
    async put(relay) {

        insist(relay.relayUrl, "string");
        insist(relay.relayType, "string");

        if (relay.relayPkh != null) {
            insist(relay.relayPkh, "string");
        }

        if (relay.relayToken != null) {
            insist(relay.relayToken, "string");
        }

        const key = await this.writeLock.run(
            () => this.storage.relaysPut(relay)
        );

        this.#published(relay, false);

        return key;
    }

    /**
     * Returns the number of relays removed (0 or 1).
     */
    async delete({ relayUrl }) {

        insist(relayUrl, "string");

        const relay = await this.writeLock.run(async () => {

            const [relay] = await this.storage.relaysGet({ relayUrl });

            if (relay) {
                await this.storage.relaysDelete({ relayUrl });
            }

            return relay;
        });

        if (!relay) {
            return 0;
        }

        this.#published(relay, true);

        return 1;
    }

    /**
     * Merge sync fields from state onto the stored record. Returns the
     * stored record, or null if the relay was deleted (it is not
     * resurrected). Publishes RELAY only if a notable field changed.
     */
    async recordProgress(relayUrl, state) {

        const { stored, changed } = await this.writeLock.run(async () => {

            const [current] = await this.storage.relaysGet({ relayUrl });

            if (!current) {
                return { stored: null, changed: false };
            }

            const merged = { ...current };

            for (const field of SYNC_FIELDS) {
                if (state[field] !== undefined) {
                    merged[field] = state[field];
                }
            }

            await this.storage.relaysPut(merged);

            return {
                stored: merged,
                changed: NOTIFY_FIELDS.some(field => merged[field] !== current[field]),
            };
        });

        if (changed) {
            this.#published(stored, false);
        }

        return stored;
    }

    #published(relay, deleted) {

        this.eventBus.publish({
            type: EventTypes.RELAY,
            relay,
            deleted,
        });
    }
}
