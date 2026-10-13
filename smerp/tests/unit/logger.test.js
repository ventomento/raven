import test from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../../src/log/logger.js";
import { VirtualClock } from "../helpers/fakes.js";

// A console stand-in that records [level, ...args] per call.
function recordingSink() {

    const calls = [];
    const sink = { calls };

    for (const level of ["debug", "info", "warn", "error"]) {
        sink[level] = (...args) => calls.push([level, ...args]);
    }

    return sink;
}

// 2026-01-02T03:04:05.678Z
const T = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

test("off by default: nothing reaches the sink", () => {

    const sink = recordingSink();
    const logger = new Logger({ sink });

    logger.debug("a");
    logger.info("b", { x: 1 });
    logger.warn("c");
    logger.error("d");
    logger.child({ relayUrl: "r" }).warn("e");

    assert.equal(logger.enabled, false);
    assert.deepEqual(sink.calls, []);
});

test("each level goes to the sink method of the same name, with prefix and time", () => {

    const sink = recordingSink();
    const logger = new Logger({ enabled: true, sink, clock: new VirtualClock(T) });

    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");

    assert.deepEqual(sink.calls, [
        ["debug", "[smerp] 03:04:05.678 a"],
        ["info", "[smerp] 03:04:05.678 b"],
        ["warn", "[smerp] 03:04:05.678 c"],
        ["error", "[smerp] 03:04:05.678 d"],
    ]);
});

test("fields are passed as one object; an empty one is left out", () => {

    const sink = recordingSink();
    const logger = new Logger({ enabled: true, sink, clock: new VirtualClock(T), prefix: "[t]" });

    logger.info("with", { a: 1 });
    logger.info("empty", {});

    assert.deepEqual(sink.calls, [
        ["info", "[t] 03:04:05.678 with", { a: 1 }],
        ["info", "[t] 03:04:05.678 empty"],
    ]);
});

test("child adds its fields to every line, and shares enabled and sink", () => {

    const sink = recordingSink();
    const clock = new VirtualClock(T);
    const child = new Logger({ enabled: true, sink, clock })
        .child({ relayUrl: "https://a" })
        .child({ step: 1 });

    child.warn("bare");
    child.warn("more", { reason: "x", step: 2 });

    assert.equal(child.enabled, true);
    assert.deepEqual(sink.calls, [
        ["warn", "[smerp] 03:04:05.678 bare", { relayUrl: "https://a", step: 1 }],
        ["warn", "[smerp] 03:04:05.678 more", { relayUrl: "https://a", step: 2, reason: "x" }],
    ]);
});

test("a call's fields do not leak into the next line", () => {

    const sink = recordingSink();
    const logger = new Logger({ enabled: true, sink, clock: new VirtualClock(T) }).child({ a: 1 });

    logger.info("one", { b: 2 });
    logger.info("two");

    assert.deepEqual(sink.calls[1], ["info", "[smerp] 03:04:05.678 two", { a: 1 }]);
});
