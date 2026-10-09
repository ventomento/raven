import { PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { EnvelopeStream } from "./envelope-stream.js";
import { RealClock, RelayRateLimits } from "./rate-limiter.js";
import { Authenticator } from "../auth/authenticator.js";
import { IngestOutcome } from "../ingest/ingestor.js";
import { EventTypes } from "../event/event-bus.js";

// Relay record fields owned by sync. Sync writes back only these, so a
// user's relaysPut during a sync (disabled, relayPkh, ...) is kept.
const SYNC_FIELDS = Object.freeze([
    "cursor",
    "failureCount",
    "lastSuccessAt",
    "lastFailureAt",
]);

export class SyncEngine {

    static DEFAULTS = Object.freeze({
        concurrency: 6,
        // Safety net against a relay that never says it is exhausted.
        // The rate limit, not this, is what protects the relay.
        maxRequestsPerSync: 1000,
        backoffBaseMs: 30 * 1000,
        backoffMaxMs: 60 * 60 * 1000,
    });

    /**
     * Wait before retrying a relay after failureCount consecutive
     * failures: 30s, 60s, 2m, ... capped at 1h.
     */
    static backoffMs(failureCount) {

        const { backoffBaseMs, backoffMaxMs } = SyncEngine.DEFAULTS;

        return Math.min(
            backoffBaseMs * 2 ** (failureCount - 1),
            backoffMaxMs
        );
    }

    constructor({
        identity,
        transporter,
        storage,
        ingestor,
        logger,
        eventBus,
        pkh,
        clock = RealClock,
        rateLimits = new RelayRateLimits({ clock }),
    }) {

        insist(identity, PrivateIdentity);
        insist(transporter);
        insist(storage);
        insist(ingestor);
        insist(logger);
        insist(eventBus);
        insist(pkh);
        insist(rateLimits, RelayRateLimits);

        this.identity = identity;
        this.transporter = transporter;
        this.logger = logger;
        this.storage = storage;
        this.ingestor = ingestor;
        this.eventBus = eventBus;
        this.pkh = pkh;
        this.clock = clock;
        this.rateLimits = rateLimits;
        this.concurrencyLimiter = new ConcurrencyLimiter(SyncEngine.DEFAULTS.concurrency);

        // relayPkh -> Authenticator, so the HMAC key is derived once.
        this.authenticators = new Map();
    }

    async syncRelays(relays) {

        const due = relays.filter(
            relay => !relay.disabled && this.isDue(relay)
        );

        const settled = await Promise.allSettled(
            due.map(
                relay => this.syncRelay(relay)
            )
        );

        settled.forEach((x, i) => {

            if (x.status !== "rejected") {
                return;
            }

            this.logger.info("Sync Process rejection: ", x.reason);

            this.eventBus.publish({
                type: EventTypes.ERROR,
                error: x.reason,
                relayUrl: due[i].relayUrl,
            });
        });

    }

    // False while the relay is backing off after failures or has asked
    // us to wait (429).
    isDue(relay) {

        if (this.rateLimits.for(relay.relayUrl).isPaused()) {
            return false;
        }

        const failureCount = relay.failureCount ?? 0;

        if (failureCount === 0) {
            return true;
        }

        return this.clock.now() >=
            (relay.lastFailureAt ?? 0) + SyncEngine.backoffMs(failureCount);
    }

    async syncRelay(relay) {

        const before = { cursor: relay.cursor, failureCount: relay.failureCount };

        const envelopeStream =
            new EnvelopeStream({
                identity: this.identity,
                relay,
                transporter: this.transporter,
                logger: this.logger,
                clock: this.clock,
                authenticator: this.authenticatorFor(relay),
            });

        const rateLimiter = this.rateLimits.for(relay.relayUrl);

        let stored = null;

        for (let i = 0; i < SyncEngine.DEFAULTS.maxRequestsPerSync; i++) {

            // Rate token first, so a request waiting on the relay's rate
            // does not hold a concurrency slot other relays could use.
            await rateLimiter.acquire();

            const result = await this.concurrencyLimiter.run(
                () => envelopeStream.next()
            );

            if (result.type === "throttled") {
                rateLimiter.pause(this.clock.now() + result.retryAfterMs);
                break;
            }

            if (result.type === "failure") {
                this.eventBus.publish({
                    type: EventTypes.ERROR,
                    error: result.error,
                    relayUrl: relay.relayUrl,
                });
                break;
            }

            if (result.type === "exhausted") {
                break;
            }

            // "envelope" or "invalid-body". Ingest before advancing the
            // cursor: if ingest throws (storage), the cursor stays and the
            // envelope is fetched again next sync; dedup makes that safe.
            await this.ingest(relay, result);

            relay.cursor = result.cursor;

            stored = await this.saveSyncState(relay);

            // Deleted while syncing: stop, do not resurrect it.
            if (!stored) {
                return;
            }
        }

        stored = await this.saveSyncState(relay);

        if (!stored) {
            return;
        }

        if (
            stored.cursor !== before.cursor ||
            stored.failureCount !== before.failureCount
        ) {
            this.eventBus.publish({
                type: EventTypes.RELAY,
                relay: stored,
                deleted: false,
            });
        }
    }

    // A rejected envelope (or a non-binary body) is skipped, never
    // retried: it would fail the same way every time and stall the relay.
    async ingest(relay, result) {

        let rejected;

        if (result.type === "invalid-body") {
            rejected = { uuid: null, reason: "relay returned a non-binary body" };
        }
        else {
            const ingested = await this.ingestor.ingest(result.bytes);

            if (ingested.outcome === IngestOutcome.REJECTED) {
                rejected = ingested;
            }
        }

        if (rejected) {
            this.eventBus.publish({
                type: EventTypes.REJECTED,
                relayUrl: relay.relayUrl,
                cursor: result.cursor,
                uuid: rejected.uuid,
                reason: rejected.reason,
            });
        }
    }

    // Merge sync fields onto the current stored record. Returns the
    // stored record, or null if the relay was deleted.
    async saveSyncState(relay) {

        const [stored] = await this.storage.relaysGet({ relayUrl: relay.relayUrl });

        if (!stored) {
            return null;
        }

        const merged = { ...stored };

        for (const field of SYNC_FIELDS) {
            if (relay[field] !== undefined) {
                merged[field] = relay[field];
            }
        }

        await this.storage.relaysPut(merged);

        return merged;
    }

    authenticatorFor(relay) {

        let authenticator = this.authenticators.get(relay.relayPkh);

        if (!authenticator) {

            authenticator = new Authenticator({
                identity: this.identity,
                relay: { relayPkh: relay.relayPkh },
                clock: this.clock,
            });

            this.authenticators.set(relay.relayPkh, authenticator);
        }

        return authenticator;
    }
}
