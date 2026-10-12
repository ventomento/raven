import { RealClock } from "./clock.js";

/**
 * Token bucket rate limiter.
 *
 * The bucket holds up to `burst` tokens and refills at `ratePerSecond`.
 * acquire() takes one token, waiting for a refill if the bucket is
 * empty. So after an idle period `burst` calls go through at once, and
 * the sustained rate is `ratePerSecond`. Waiters are served in FIFO
 * order. Tokens are never returned: only time refills the bucket.
 *
 * pause(untilMs) blocks every acquire until that time, e.g. for a
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
