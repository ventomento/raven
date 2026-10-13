import test from "node:test";
import assert from "node:assert/strict";

import { Scheduler } from "../../src/sync/scheduler.js";
import { VirtualClock, tick } from "../helpers/fakes.js";
import { FakeSession, ScriptedSession } from "../helpers/relay-fixtures.js";

// The scheduler against fake sessions: FakeSession steps are settled by
// the test, ScriptedSession steps answer from a script at once.

function setup(options = {}) {

    const clock = new VirtualClock();
    const errors = [];

    const scheduler = new Scheduler({
        clock,
        onError: (error, session) => errors.push({ error, session }),
        ...options,
    });

    return { clock, scheduler, errors };
}

// Whether promise has settled, after letting pending work run.
async function isSettled(promise) {

    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });

    await tick();

    return settled;
}

test("concurrency must be a positive integer, onError a function", () => {

    for (const concurrency of [0, -1, 1.5, "2", Infinity]) {
        assert.throws(() => new Scheduler({ concurrency }), /positive integer/, String(concurrency));
    }

    assert.throws(() => new Scheduler({ onError: "log" }));
    assert.equal(new Scheduler().concurrency, Scheduler.DEFAULTS.concurrency);
});

test("add insists on step and notBefore", () => {

    const { scheduler } = setup();

    assert.throws(() => scheduler.add({ notBefore: () => 0 }));
    assert.throws(() => scheduler.add({ step: async () => false }));
});

test("wake with no sessions resolves at once", async () => {

    const { scheduler } = setup();

    assert.equal(await isSettled(scheduler.wake()), true);
});

test("sessions are idle until woken", async () => {

    const { scheduler } = setup();
    const log = [];

    scheduler.add(new ScriptedSession("A", [], log));
    await tick();

    assert.deepEqual(log, []);

    await scheduler.wake();
    assert.deepEqual(log, ["A"]);
});

test("each session steps until it has no more; more goes to the back of the line", async () => {

    const { scheduler } = setup({ concurrency: 1 });
    const log = [];

    scheduler.add(new ScriptedSession("A", [true, true], log));
    scheduler.add(new ScriptedSession("B", [true], log));
    scheduler.add(new ScriptedSession("C", [], log));

    await scheduler.wake();

    assert.deepEqual(log, ["A", "B", "C", "A", "B", "A"]);
});

test("only true means more: other values count as done", async () => {

    const { scheduler } = setup();
    const log = [];

    for (const [name, value] of [["one", 1], ["yes", "yes"], ["obj", {}]]) {
        scheduler.add(new ScriptedSession(name, [value], log));
    }

    await scheduler.wake();

    assert.deepEqual(log, ["one", "yes", "obj"]);
});

test("never more than concurrency steps in flight", async () => {

    const { scheduler } = setup({ concurrency: 2 });

    let inFlight = 0;
    let maxInFlight = 0;
    let steps = 0;

    for (let i = 0; i < 5; i++) {

        let remaining = 3;

        scheduler.add({
            notBefore: () => 0,
            step: async () => {
                inFlight++;
                steps++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await tick();
                inFlight--;
                return --remaining > 0;
            },
        });
    }

    await scheduler.wake();

    assert.equal(steps, 15);
    assert.equal(maxInFlight, 2);
});

test("a free slot is taken at once when a step ends", async () => {

    const { scheduler } = setup({ concurrency: 2 });
    const [a, b, c] = ["A", "B", "C"].map(name => new FakeSession(name));

    for (const session of [a, b, c]) {
        scheduler.add(session);
    }

    const done = scheduler.wake();
    await tick();

    assert.deepEqual([a, b, c].map(s => s.steps.length), [1, 1, 0]);
    assert.equal(scheduler.running.size, 2);

    b.current.resolve(false);
    await tick();

    assert.deepEqual([a, b, c].map(s => s.steps.length), [1, 1, 1]);

    a.current.resolve(false);
    c.current.resolve(false);

    assert.equal(await isSettled(done), true);
    assert.equal(scheduler.idle.size, 3);
});

test("a session waits for its notBefore, with one timer for the earliest", async () => {

    const { clock, scheduler } = setup();
    const soon = new FakeSession("soon", { notBeforeAt: clock.now() + 1000 });
    const later = new FakeSession("later", { notBeforeAt: clock.now() + 2000 });

    scheduler.add(later);
    scheduler.add(soon);

    const done = scheduler.wake();
    await tick();

    assert.equal(soon.steps.length + later.steps.length, 0);
    assert.equal(clock.alarms.length, 1);
    assert.equal(clock.alarms[0].at, clock.now() + 1000);

    clock.advance(999);
    await tick();
    assert.equal(soon.steps.length, 0);

    clock.advance(1);
    await tick();
    assert.equal(soon.steps.length, 1);
    assert.equal(later.steps.length, 0);
    assert.equal(clock.alarms.length, 1, "re-armed for the next one");

    soon.current.resolve(false);
    clock.advance(1000);
    await tick();
    assert.equal(later.steps.length, 1);

    later.current.resolve(false);
    assert.equal(await isSettled(done), true);
    assert.equal(clock.alarms.length, 0);
});

test("no timer while every slot is taken", async () => {

    const { clock, scheduler } = setup({ concurrency: 1 });
    const busy = new FakeSession("busy");
    const waiting = new FakeSession("waiting", { notBeforeAt: clock.now() + 1000 });

    scheduler.add(busy);
    scheduler.add(waiting);

    scheduler.wake();
    await tick();

    assert.equal(busy.steps.length, 1);
    assert.equal(clock.alarms.length, 0);

    busy.current.resolve(false);
    await tick();

    assert.equal(clock.alarms.length, 1);
    await scheduler.stop();
});

test("a session out of tokens (true without a request) waits for its notBefore", async () => {

    const { clock, scheduler } = setup();
    const session = new FakeSession("A");

    scheduler.add(session);
    const done = scheduler.wake();
    await tick();

    session.notBeforeAt = clock.now() + 500;
    session.current.resolve(true);
    await tick();

    assert.equal(session.steps.length, 1);

    clock.advance(500);
    await tick();
    assert.equal(session.steps.length, 2);

    session.current.resolve(false);
    assert.equal(await isSettled(done), true);
});

test("a rejected or throwing step goes to onError and counts as done", async () => {

    const { scheduler, errors } = setup();
    const log = [];
    const rejected = new Error("rejected");
    const thrown = new Error("thrown");

    const async = new ScriptedSession("async", [rejected], log);
    const sync = {
        notBefore: () => 0,
        step: () => { throw thrown; },
    };
    const fine = new ScriptedSession("fine", [true], log);

    scheduler.add(async);
    scheduler.add(sync);
    scheduler.add(fine);

    await scheduler.wake();

    const reported = new Map(errors.map(e => [e.error, e.session]));
    assert.equal(errors.length, 2);
    assert.equal(reported.get(rejected), async);
    assert.equal(reported.get(thrown), sync);
    assert.deepEqual(log, ["async", "fine", "fine"]);
    assert.equal(scheduler.idle.size, 3);
});

test("wake while busy shares one promise; a later wake runs everything again", async () => {

    const { scheduler } = setup();
    const session = new FakeSession("A");

    scheduler.add(session);

    const first = scheduler.wake();
    assert.equal(scheduler.wake(), first);

    await tick();
    session.current.resolve(false);
    await first;

    const second = scheduler.wake();
    assert.notEqual(second, first);

    await tick();
    assert.equal(session.steps.length, 2);
    session.current.resolve(false);
    await second;
});

test("wake while busy brings sessions that finished back in", async () => {

    const { scheduler } = setup();
    const log = [];
    const slow = new FakeSession("slow");

    scheduler.add(slow);
    scheduler.add(new ScriptedSession("quick", [], log));

    const done = scheduler.wake();
    await tick();
    assert.deepEqual(log, ["quick"]);

    scheduler.wake();
    await tick();
    assert.deepEqual(log, ["quick", "quick"]);
    assert.equal(slow.steps.length, 1, "a running session is not started twice");

    slow.current.resolve(false);
    await done;
});

test("stop waits for running steps, starts nothing more, resolves open wakes", async () => {

    const { scheduler } = setup({ concurrency: 1 });
    const running = new FakeSession("running");
    const pending = new FakeSession("pending");

    scheduler.add(running);
    scheduler.add(pending);

    const woken = scheduler.wake();
    await tick();

    const stopped = scheduler.stop();
    assert.equal(await isSettled(stopped), false, "waits for the running step");

    running.current.resolve(true);
    await stopped;

    assert.equal(running.steps.length, 1, "more after stop is not run");
    assert.equal(pending.steps.length, 0);
    assert.equal(await isSettled(woken), true);
    assert.equal(scheduler.pending.size, 0);
    assert.equal(scheduler.running.size, 0);
    assert.equal(scheduler.idle.size, 2);

    assert.equal(await isSettled(scheduler.wake()), true);
    await tick();
    assert.equal(running.steps.length + pending.steps.length, 1, "wake after stop runs nothing");
});

test("stop cancels the timer", async () => {

    const { clock, scheduler } = setup();

    scheduler.add(new FakeSession("later", { notBeforeAt: clock.now() + 1000 }));
    scheduler.wake();
    await tick();

    assert.equal(clock.alarms.length, 1);

    await scheduler.stop();

    assert.equal(clock.alarms.length, 0);
});
