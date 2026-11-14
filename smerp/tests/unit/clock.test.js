import test from "node:test";
import assert from "node:assert/strict";

import { RealClock } from "../../src/lib/clock.js";

test("now is wall time in ms", () => {

    const before = Date.now();
    const now = RealClock.now();

    assert.ok(now >= before && now <= Date.now());
});

test("sleep resolves after the delay", async () => {

    const start = Date.now();
    await RealClock.sleep(20);

    assert.ok(Date.now() - start >= 15);
});

test("timer fires once, and its cancel stops it", async () => {

    let fired = 0;
    let cancelledFired = 0;

    RealClock.timer(5, () => fired++);
    const cancel = RealClock.timer(5, () => cancelledFired++);
    cancel();

    await RealClock.sleep(30);

    assert.equal(fired, 1);
    assert.equal(cancelledFired, 0);
});
