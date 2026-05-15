// concurrency-limiter.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {ConcurrencyLimiter} from "../src/sync/concurrency-limiter.js";

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

test(
    "constructor rejects invalid limits",
    () => {

        assert.throws(
            () => new ConcurrencyLimiter(0)
        );

        assert.throws(
            () => new ConcurrencyLimiter(-1)
        );

        assert.throws(
            () => new ConcurrencyLimiter(1.5)
        );

    }
);

test(
    "runs tasks",
    async () => {

        const limiter =
            new ConcurrencyLimiter(2);

        const result =
            await limiter.run(
                async () => 123
            );

        assert.equal(result, 123);

    }
);

test(
    "never exceeds concurrency limit",
    async () => {

        const limiter =
            new ConcurrencyLimiter(3);

        let running = 0;
        let observedMax = 0;

        const tasks =
            Array.from(
                { length: 100 },
                (_, i) =>
                    limiter.run(async () => {

                        running++;

                        observedMax =
                            Math.max(
                                observedMax,
                                running
                            );

                        // Force scheduling interleavings.
                        await sleep(
                            Math.random() * 10
                        );

                        running--;

                        return i;

                    })
            );

        await Promise.all(tasks);

        assert.equal(observedMax, 3);

    }
);

test(
    "preserves FIFO wakeup ordering",
    async () => {

        const limiter =
            new ConcurrencyLimiter(1);

        const started = [];
        const completed = [];

        const tasks =
            Array.from(
                { length: 5 },
                (_, i) =>
                    limiter.run(async () => {

                        started.push(i);

                        await sleep(5);

                        completed.push(i);

                    })
            );

        await Promise.all(tasks);

        assert.deepEqual(
            started,
            [0, 1, 2, 3, 4]
        );

        assert.deepEqual(
            completed,
            [0, 1, 2, 3, 4]
        );

    }
);

test(
    "releases slot after thrown error",
    async () => {

        const limiter =
            new ConcurrencyLimiter(1);

        const events = [];

        const failing =
            limiter.run(async () => {

                events.push("start-fail");

                throw new Error("boom");

            });

        await assert.rejects(failing);

        await limiter.run(async () => {

            events.push("start-next");

        });

        assert.deepEqual(
            events,
            [
                "start-fail",
                "start-next",
            ]
        );

        assert.equal(
            limiter.active,
            0
        );

    }
);

test(
    "active count returns to zero",
    async () => {

        const limiter =
            new ConcurrencyLimiter(5);

        await Promise.all(
            Array.from(
                { length: 50 },
                () =>
                    limiter.run(async () => {
                        await sleep(1);
                    })
            )
        );

        assert.equal(
            limiter.active,
            0
        );

        assert.equal(
            limiter.queue.length,
            0
        );

    }
);

test(
    "stress test with heavy interleaving",
    async () => {

        const limiter =
            new ConcurrencyLimiter(4);

        let running = 0;

        const tasks =
            Array.from(
                { length: 1000 },
                (_, i) =>
                    limiter.run(async () => {

                        running++;

                        assert.ok(
                            running <= 4,
                            `running=${running}`
                        );

                        // Force microtask + macrotask mixing.
                        await Promise.resolve();

                        await sleep(
                            Math.random() * 2
                        );

                        running--;

                        return i;

                    })
            );

        const results =
            await Promise.all(tasks);

        assert.equal(
            results.length,
            1000
        );

        assert.equal(
            limiter.active,
            0
        );

    }
);