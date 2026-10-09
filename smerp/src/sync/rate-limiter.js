// Request rate limits that protect relays from the client.
//
// ConcurrencyLimiter protects the client (how many requests run at once).
// RateLimiter protects one relay (how often it is asked), and holds across
// syncs and sends, so a burst of send() calls cannot stack up requests.

export const RealClock = Object.freeze({
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
});

/**
 * Token bucket: `burst` requests at once, refilled at `ratePerSecond`.
 * Waiters are served in FIFO order.
 *
 * pause(untilMs) blocks it entirely, e.g. for a relay's Retry-After.
 */
export class RateLimiter {

    constructor({
        ratePerSecond,
        burst,
        clock = RealClock,
    }) {

        if (!(ratePerSecond > 0) || !Number.isInteger(burst) || burst < 1) {
            throw new Error("RateLimiter: ratePerSecond must be > 0, burst an integer >= 1");
        }

        this.ratePerSecond = ratePerSecond;
        this.burst = burst;
        this.clock = clock;

        this.tokens = burst;
        this.refilledAt = clock.now();
        this.pausedUntil = 0;

        // Chain of pending acquires, for FIFO order.
        this.tail = Promise.resolve();
    }

    acquire() {

        const turn = this.tail.then(() => this.#take());

        this.tail = turn.catch(() => {});

        return turn;
    }

    pause(untilMs) {
        this.pausedUntil = Math.max(this.pausedUntil, untilMs);
    }

    isPaused() {
        return this.clock.now() < this.pausedUntil;
    }

    async #take() {

        for (;;) {

            const now = this.clock.now();

            if (now < this.pausedUntil) {
                await this.clock.sleep(this.pausedUntil - now);
                continue;
            }

            this.#refill(now);

            if (this.tokens >= 1) {
                this.tokens -= 1;
                return;
            }

            await this.clock.sleep(
                Math.ceil((1 - this.tokens) * 1000 / this.ratePerSecond)
            );
        }
    }

    #refill(now) {

        const elapsedMs = Math.max(0, now - this.refilledAt);

        this.tokens = Math.min(
            this.burst,
            this.tokens + elapsedMs * this.ratePerSecond / 1000
        );

        this.refilledAt = now;
    }
}

/**
 * One RateLimiter per relay, keyed by relayUrl, created on first use.
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

            limiter = new RateLimiter({
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
