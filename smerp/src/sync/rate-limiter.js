// Request rate limits that protect relays from the client.
//
// ConcurrencyLimiter protects the client (how many requests run at once).
// A TokenBucket per relay protects that relay (how often it is asked), and
// holds across syncs and sends, so a burst of send() calls cannot stack up
// requests.

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
        this.limiters = new Map();
    }

    for(relayUrl) {

        let limiter = this.limiters.get(relayUrl);

        if (!limiter) {

            limiter = new TokenBucket({
                ratePerSecond: this.ratePerSecond,
                burst: this.burst,
                clock: this.clock,
            });

            this.limiters.set(relayUrl, limiter);
        }

        return limiter;
    }
}

/**
 * Milliseconds to wait from a 429 response's Retry-After header.
 * Accepts delay-seconds or an HTTP date; anything else gets the default.
 */
export function retryAfterMs(headers, now, defaultMs = 5000) {

    const value = headers?.["retry-after"];

    if (value === undefined) {
        return defaultMs;
    }

    if (/^\s*\d+\s*$/.test(value)) {
        return Number(value) * 1000;
    }

    const date = Date.parse(value);

    return Number.isNaN(date)
        ? defaultMs
        : Math.max(0, date - now);
}
