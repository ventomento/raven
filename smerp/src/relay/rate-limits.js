// Request rate limits that protect relays from the client.
//
// The pool's slot count protects the client (how many requests run at
// once). A TokenBucket per relay protects that relay (how often it is
// asked). The buckets are kept here, outside the sessions, so they hold
// across syncs, sends and client restarts.

import { RealClock } from "../lib/clock.js";
import { TokenBucket } from "../lib/token-bucket.js";

/**
 * One TokenBucket per relay, keyed by relayUrl, created on first use.
 */
export class RelayRateLimits {

    static DEFAULTS = Object.freeze({
        ratePerSecond: 2,
        burst: 3,
    });

    constructor({
        ratePerSecond = RelayRateLimits.DEFAULTS.ratePerSecond,
        burst = RelayRateLimits.DEFAULTS.burst,
        clock = RealClock,
    } = {}) {

        this.ratePerSecond = ratePerSecond;
        this.burst = burst;
        this.clock = clock;
        this.buckets = new Map();
    }

    for(relayUrl) {

        let bucket = this.buckets.get(relayUrl);

        if (!bucket) {

            bucket = new TokenBucket({
                ratePerSecond: this.ratePerSecond,
                burst: this.burst,
                clock: this.clock,
            });

            this.buckets.set(relayUrl, bucket);
        }

        return bucket;
    }
}
