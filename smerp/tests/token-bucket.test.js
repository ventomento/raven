import test from "node:test";
import assert from "node:assert/strict";

import { TokenBucket } from "../src/lib/token-bucket.js";
import { VirtualClock } from "./helpers/fakes.js";

// Takes n tokens, jumping time to nextTokenAt() whenever none is left.
function takeTimes(bucket, clock, n) {

    const start = clock.now();
    const times = [];

    while (times.length < n) {

        if (bucket.tryTake()) {
            times.push(clock.now() - start);
            continue;
        }

        clock.advance(bucket.nextTokenAt() - clock.now());
    }

    return times;
}

test("allows a burst, then the sustained rate", () => {

    const clock = new VirtualClock();
    const bucket = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });

    assert.deepEqual(
        takeTimes(bucket, clock, 7),
        [0, 0, 0, 500, 1000, 1500, 2000]
    );
});

test("tryTake never waits and nextTokenAt says when to retry", () => {

    const clock = new VirtualClock();
    const bucket = new TokenBucket({ ratePerSecond: 2, burst: 1, clock });

    assert.equal(bucket.nextTokenAt(), clock.now());
    assert.equal(bucket.tryTake(), true);
    assert.equal(bucket.tryTake(), false);
    assert.equal(bucket.nextTokenAt(), clock.now() + 500);

    clock.advance(499);
    assert.equal(bucket.tryTake(), false);

    clock.advance(1);
    assert.equal(bucket.tryTake(), true);
});

test("idle time refills up to the burst, not beyond", () => {

    const clock = new VirtualClock();
    const bucket = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });

    takeTimes(bucket, clock, 3);
    clock.advance(60 * 1000);

    assert.deepEqual(
        takeTimes(bucket, clock, 4),
        [0, 0, 0, 500]
    );
});

test("pause withholds tokens until the given time", () => {

    const clock = new VirtualClock();
    const bucket = new TokenBucket({ ratePerSecond: 2, burst: 3, clock });
    const start = clock.now();

    bucket.pause(start + 10 * 1000);

    assert.equal(bucket.isPaused(), true);
    assert.equal(bucket.tryTake(), false);
    assert.equal(bucket.nextTokenAt(), start + 10 * 1000);

    clock.advance(10 * 1000);

    assert.equal(bucket.isPaused(), false);
    assert.equal(bucket.tryTake(), true);
});
