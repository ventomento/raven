import { RealClock } from "./clock.js";

const EPSILON = 1e-9;

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
    }

    tryTake() {

        const now = this.clock.now();

        this.#refill(now);

        if (this.tokens < 1 - EPSILON) {
            return false;
        }

        this.tokens = Math.max(0, this.tokens - 1);

        return true;
    }

    nextTokenAt() {

        const now = this.clock.now();

        this.#refill(now);

        if (this.tokens >= 1 - EPSILON) {
            return now;
        }

        return now + Math.ceil((1 - this.tokens) * 1000 / this.ratePerSecond);
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
