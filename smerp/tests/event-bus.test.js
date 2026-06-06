// event-bus.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { EventBus, EventTypes, isValidEventType } from "../src/event/event-bus.js";

test("isValidEventType: should validate known event types", () => {
  assert.equal(isValidEventType(EventTypes.NEW_CONVERSATION), true);
  assert.equal(isValidEventType("invalid.event"), false);
  assert.equal(isValidEventType(123), false);
});

test("EventBus: subscribe should register callback and receive event", async () => {
  const bus = new EventBus();

  let received = null;

  bus.subscribe(EventTypes.NEW_CONVERSATION, (event) => {
    received = event;
  });

  bus.publish({
    type: EventTypes.NEW_CONVERSATION,
    payload: "hello",
  });

  await new Promise((r) => setTimeout(r, 0));

  assert.ok(received);
  assert.equal(received.type, EventTypes.NEW_CONVERSATION);
  assert.equal(received.payload, "hello");
  assert.ok(typeof received.timestamp === "number");
});

test("EventBus: invalid eventType should throw on subscribe", () => {
  const bus = new EventBus();

  assert.throws(() => {
    bus.subscribe("bad.event", () => {});
  });
});

test("EventBus: unsubscribe should stop receiving events", async () => {
  const bus = new EventBus();

  let count = 0;

  const unsubscribe = bus.subscribe(EventTypes.NEW_ENVELOPE, () => {
    count++;
  });

  bus.publish({ type: EventTypes.NEW_ENVELOPE });
  unsubscribe();
  bus.publish({ type: EventTypes.NEW_ENVELOPE });

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(count, 1);
});

test("EventBus: multiple subscribers should all be called", async () => {
  const bus = new EventBus();

  let a = 0;
  let b = 0;

  bus.subscribe(EventTypes.RESULTS_DISPATCH, () => {
    a++;
  });

  bus.subscribe(EventTypes.RESULTS_DISPATCH, () => {
    b++;
  });

  bus.publish({ type: EventTypes.RESULTS_DISPATCH });

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("EventBus: async handler should not break publish flow", async () => {
  const bus = new EventBus();

  let done = false;

  bus.subscribe(EventTypes.NEW_CONVERSATION, async () => {
    await new Promise((r) => setTimeout(r, 5));
    done = true;
  });

  bus.publish({ type: EventTypes.NEW_CONVERSATION });

  await new Promise((r) => setTimeout(r, 20));

  assert.equal(done, true);
});

test("EventBus: sync handler errors should not crash bus", async () => {
  const bus = new EventBus();

  let secondCalled = false;

  bus.subscribe(EventTypes.NEW_ENVELOPE, () => {
    throw new Error("fail");
  });

  bus.subscribe(EventTypes.NEW_ENVELOPE, () => {
    secondCalled = true;
  });

  bus.publish({ type: EventTypes.NEW_ENVELOPE });

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(secondCalled, true);
});

test("EventBus: event should be enriched with timestamp", async () => {
  const bus = new EventBus();

  let received = null;

  bus.subscribe(EventTypes.RESULTS_DISPATCH, (event) => {
    received = event;
  });

  bus.publish({ type: EventTypes.RESULTS_DISPATCH });

  await new Promise((r) => setTimeout(r, 0));

  assert.ok(received.timestamp);
  assert.ok(typeof received.timestamp === "number");
});

test("EventBus: unsubscribe cleans up empty listener set", () => {
  const bus = new EventBus();

  const unsubscribe = bus.subscribe(EventTypes.NEW_CONVERSATION, () => {});
  unsubscribe();

  assert.equal(bus.listeners.has(EventTypes.NEW_CONVERSATION), false);
});