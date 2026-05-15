import test from "node:test";
import assert from "node:assert/strict";

import { TaskStack } from "../src/sync/task-stack.js";

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

test("runs tasks up to concurrency limit", async () => {
    const stack = new TaskStack(2);

    let running = 0;
    let maxRunning = 0;

    const tasks = [];

    for (let i = 0; i < 5; i++) {
        tasks.push(
            new Promise(resolve => {
                stack.add(async () => {
                    running++;

                    maxRunning = Math.max(
                        maxRunning,
                        running
                    );

                    await sleep(50);

                    running--;

                    resolve();
                });
            })
        );
    }

    await Promise.all(tasks);

    assert.equal(maxRunning, 2);
});

test("runs all tasks", async () => {
    const stack = new TaskStack(3);

    let completed = 0;

    const tasks = [];

    for (let i = 0; i < 10; i++) {
        tasks.push(
            new Promise(resolve => {
                stack.add(async () => {
                    await sleep(10);

                    completed++;

                    resolve();
                });
            })
        );
    }

    await Promise.all(tasks);

    assert.equal(completed, 10);
});

test("continues processing after rejection", async () => {
    const stack = new TaskStack(1);

    const results = [];

    const p1 = new Promise(resolve => {
        stack.add(async () => {
            results.push("first");

            throw new Error("boom");
        });

        // allow async rejection handling
        setTimeout(resolve, 20);
    });

    const p2 = new Promise(resolve => {
        stack.add(async () => {
            results.push("second");

            resolve();
        });
    });

    await Promise.all([p1, p2]);

    assert.deepEqual(results, [
        "first",
        "second",
    ]);
});

test("supports synchronous runnables", async () => {
    const stack = new TaskStack(2);

    let count = 0;

    stack.add(() => {
        count++;
    });

    stack.add(() => {
        count++;
    });

    // allow promise finally handlers to run
    await sleep(10);

    assert.equal(count, 2);
});

test("processes tasks in LIFO order", async () => {
    const stack = new TaskStack(1);

    const order = [];

    stack.add(async () => {
        await sleep(10);

        order.push(1);
    });

    stack.add(async () => {
        order.push(2);
    });

    stack.add(async () => {
        order.push(3);
    });

    await sleep(50);

    assert.deepEqual(order, [
        1,
        3,
        2,
    ]);
});