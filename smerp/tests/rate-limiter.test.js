import test from "node:test";
import assert from "node:assert/strict";

import { RateLimiter, RelayRateLimits, retryAfterMs } from "../src/sync/rate-limiter.js";
import { VirtualClock } from "./helpers/fakes.js";

async function acquireTimes(limiter, clock, n) {

    const start = clock.now();
    const times = [];

    for (let i = 0; i < n; i++) {
        await limiter.acquire();
        times.push(clock.now() - start);
    }

    return times;
}

test("allows a burst, then the sustained rate", async () => {

    const clock = new VirtualClock();
    const limiter = new RateLimiter({ ratePerSecond: 2, burst: 3, clock });

    assert.deepEqual(
        await acquireTimes(limiter, clock, 7),
        [0, 0, 0, 500, 1000, 1500, 2000]
    );
});

test("concurrent acquires are served in order at the rate", async () => {

    const clock = new VirtualClock();
    const limiter = new RateLimiter({ ratePerSecond: 2, burst: 1, clock });
    const start = clock.now();

    const order = [];
    await Promise.all([0, 1, 2, 3].map(i =>
        limiter.acquire().then(() => order.push([i, clock.now() - start]))
    ));

    assert.deepEqual(order, [[0, 0], [1, 500], [2, 1000], [3, 1500]]);
});

test("idle time refills up to the burst, not beyond", async () => {

    const clock = new VirtualClock();
    const limiter = new RateLimiter({ ratePerSecond: 2, burst: 3, clock });

    await acquireTimes(limiter, clock, 3);
    clock.advance(60 * 1000);

    assert.deepEqual(
        await acquireTimes(limiter, clock, 4),
        [0, 0, 0, 500]
    );
});

test("pause blocks until the given time", async () => {

    const clock = new VirtualClock();
    const limiter = new RateLimiter({ ratePerSecond: 2, burst: 3, clock });
    const start = clock.now();

    limiter.pause(start + 10 * 1000);
    assert.equal(limiter.isPaused(), true);

    await limiter.acquire();

    assert.equal(clock.now() - start, 10 * 1000);
    assert.equal(limiter.isPaused(), false);
});

test("RelayRateLimits keeps one limiter per relay", () => {

    const limits = new RelayRateLimits();

    assert.equal(limits.for("http://a"), limits.for("http://a"));
    assert.notEqual(limits.for("http://a"), limits.for("http://b"));
    assert.equal(limits.for("http://a").ratePerSecond, 2);
    assert.equal(limits.for("http://a").burst, 3);
});

test("retryAfterMs reads seconds or a date, defaults otherwise", () => {

    const now = Date.parse("2026-01-01T00:00:00Z");

    assert.equal(retryAfterMs({ "retry-after": "30" }, now), 30 * 1000);
    assert.equal(retryAfterMs({ "retry-after": "Thu, 01 Jan 2026 00:01:00 GMT" }, now), 60 * 1000);
    assert.equal(retryAfterMs({ "retry-after": "soon" }, now), 5000);
    assert.equal(retryAfterMs({}, now), 5000);
});
