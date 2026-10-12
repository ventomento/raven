import test from "node:test";
import assert from "node:assert/strict";

import { RelayRateLimits, retryAfterMs } from "../src/sync/rate-limiter.js";

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
