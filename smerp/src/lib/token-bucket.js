import { RealClock } from "./clock.js";

// Allowance for float error in refill: a token due at nextTokenAt() must
// be takeable at that time.
const EPSILON = 1e-9;

/**
 * Token bucket rate limiter. Never waits: the caller asks whether a
 * token is available now, and when the next one will be.
 *
 * The bucket holds up to `burst` tokens and refills at `ratePerSecond`.
 * So after an idle period `burst` takes go through at once, and the
 * sustained rate is `ratePerSecond`. Tokens are never returned: only
 * time refills the bucket.
 *
 * pause(untilMs) withholds every token until that time, e.g. for a
 * server's Retry-After.
 */
export class TokenBucket {

    constructor({
        ratePerSecond,
        burst,
        clock = RealClock,
    }) {

        if (!(ratePerSecond > 0) || !Number.isInteger(burst) || burst < 1) {
            throw new Error("TokenBucket: ratePerSecond must be > 0, burst an integer >= 1");
        }

        this.ratePerSecond = ratePerSecond;
        this.burst = burst;
        this.clock = clock;

        this.tokens = burst;
        this.refilledAt = clock.now();
        this.pausedUntil = 0;
    }

    // Takes a token if one is available now.
    tryTake() {

        const now = this.clock.now();

        if (now < this.pausedUntil) {
            return false;
        }

        this.#refill(now);

        if (this.tokens < 1 - EPSILON) {
            return false;
        }

        this.tokens = Math.max(0, this.tokens - 1);

        return true;
    }

    // Earliest time tryTake() can succeed: now if a token is available.
    nextTokenAt() {

        const now = this.clock.now();

        if (now < this.pausedUntil) {
            return this.pausedUntil;
        }

        this.#refill(now);

        if (this.tokens >= 1 - EPSILON) {
            return now;
        }

        return now + Math.ceil((1 - this.tokens) * 1000 / this.ratePerSecond);
    }

    pause(untilMs) {
        this.pausedUntil = Math.max(this.pausedUntil, untilMs);
    }

    isPaused() {
        return this.clock.now() < this.pausedUntil;
    }

    // Tokens accrue continuously; computed on demand rather than on a timer.
    #refill(now) {

        const elapsedMs = Math.max(0, now - this.refilledAt);

        this.tokens = Math.min(
            this.burst,
            this.tokens + elapsedMs * this.ratePerSecond / 1000
        );

        this.refilledAt = now;
    }
}
