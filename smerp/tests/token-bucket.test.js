import test from "node:test";
import assert from "node:assert/strict";

import { TokenBucket } from "../src/lib/token-bucket.js";
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
    const limiter = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });

    assert.deepEqual(
        await acquireTimes(limiter, clock, 7),
        [0, 0, 0, 500, 1000, 1500, 2000]
    );
});

test("concurrent acquires are served in order at the rate", async () => {

    const clock = new VirtualClock();
    const limiter = new TokenBucket({ ratePerSecond: 2, burst: 1, clock });
    const start = clock.now();

    const order = [];
    await Promise.all([0, 1, 2, 3].map(i =>
        limiter.acquire().then(() => order.push([i, clock.now() - start]))
    ));

    assert.deepEqual(order, [[0, 0], [1, 500], [2, 1000], [3, 1500]]);
});

test("idle time refills up to the burst, not beyond", async () => {

    const clock = new VirtualClock();
    const limiter = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });

    await acquireTimes(limiter, clock, 3);
    clock.advance(60 * 1000);

    assert.deepEqual(
        await acquireTimes(limiter, clock, 4),
        [0, 0, 0, 500]
    );
});

test("pause blocks until the given time", async () => {

    const clock = new VirtualClock();
    const limiter = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });
    const start = clock.now();

    limiter.pause(start + 10 * 1000);
    assert.equal(limiter.isPaused(), true);

    await limiter.acquire();

    assert.equal(clock.now() - start, 10 * 1000);
    assert.equal(limiter.isPaused(), false);
});
