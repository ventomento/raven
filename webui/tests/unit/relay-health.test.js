import test from "node:test";
import assert from "node:assert/strict";

import { relayHealth, throttleNotices, THROTTLE_BANNER_MS, THROTTLE_GRACE_MS } from "../../src/relay-health.js";

const NOW = 10_000_000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test("relayHealth: disabled wins over everything", () => {

  assert.deepEqual(
    relayHealth({ disabled: true, failureCount: 3, lastFailureAt: NOW }, NOW),
    { state: "disabled", label: "Disabled", retryAt: null }
  );
});

test("relayHealth: healthy after a success, not synced before any", () => {

  assert.equal(relayHealth({ failureCount: 0, lastSuccessAt: NOW - MINUTE }, NOW).state, "ok");
  assert.equal(relayHealth({}, NOW).state, "new");
  assert.equal(relayHealth({}, NOW).label, "Not synced yet");
});

test("relayHealth: failing, with the end of the session's backoff while it lasts", () => {

  // 30 s doubling: 30 s after one failure, 2 min after three.
  assert.deepEqual(
    relayHealth({ failureCount: 1, lastFailureAt: NOW, lastSuccessAt: NOW - MINUTE }, NOW),
    { state: "failing", label: "Failing", retryAt: NOW + 30 * 1000 }
  );
  assert.equal(relayHealth({ failureCount: 3, lastFailureAt: NOW }, NOW).retryAt, NOW + 2 * MINUTE);
  assert.equal(relayHealth({ failureCount: 1, lastFailureAt: NOW - MINUTE }, NOW).retryAt, null, "backoff over");
});

const SECOND = 1000;
const throttled = (seconds, sinceAgo = 0, extra = {}) => ({
  relayUrl: "http://a",
  throttledUntil: NOW + seconds * SECOND,
  throttledSince: NOW - sinceAgo,
  ...extra,
});

test("relayHealth: a short throttle keeps the state but delays the next try", () => {

  const health = relayHealth(throttled(30, 0, { lastSuccessAt: NOW - MINUTE }), NOW);

  assert.deepEqual(health, { state: "ok", label: "Healthy", retryAt: NOW + 30 * SECOND });
});

test("relayHealth: throttled at 60 s, over failing, under disabled", () => {

  assert.deepEqual(relayHealth(throttled(60), NOW), { state: "throttled", label: "Throttled", retryAt: NOW + MINUTE });
  assert.equal(relayHealth(throttled(60, 0, { failureCount: 1, lastFailureAt: NOW }), NOW).state, "throttled");
  assert.equal(relayHealth(throttled(60, 0, { disabled: true }), NOW).state, "disabled");
});

test("relayHealth: short waits that add up count as long, an ended throttle not at all", () => {

  assert.equal(relayHealth(throttled(5, 2 * MINUTE), NOW).state, "throttled");
  assert.equal(relayHealth(throttled(-1, 2 * MINUTE, { lastSuccessAt: 1 }), NOW).state, "ok");
  assert.equal(relayHealth({ ...throttled(120), throttledSince: null, lastSuccessAt: 1 }, NOW).state, "ok");
});

test("relayHealth: retryAt is the later of throttle and backoff", () => {

  const relay = throttled(5, 0, { failureCount: 3, lastFailureAt: NOW });

  assert.equal(relayHealth(relay, NOW).retryAt, NOW + 2 * MINUTE);
});

test("throttleNotices: nothing below 15 minutes, from one wait or a run", () => {

  assert.deepEqual(throttleNotices([throttled(14 * 60)], new Set(), NOW).items, []);
  assert.equal(throttleNotices([throttled(15 * 60)], new Set(), NOW).items.length, 1);
  assert.equal(throttleNotices([throttled(30, 15 * MINUTE)], new Set(), NOW).items.length, 1);
  assert.deepEqual(throttleNotices([{ relayUrl: "http://a" }], new Set(), NOW).items, []);
  assert.deepEqual(throttleNotices([{ ...throttled(15 * 60), disabled: true }], new Set(), NOW).items, []);
});

test("throttleNotices: stays for the grace after a wait, then goes", () => {

  const relay = throttled(-THROTTLE_GRACE_MS / SECOND + 1, THROTTLE_BANNER_MS + THROTTLE_GRACE_MS);
  const [item] = throttleNotices([relay], new Set(), NOW).items;

  assert.equal(item.waiting, false);
  assert.deepEqual(throttleNotices([relay], new Set(), NOW + SECOND).items, []);
});

test("throttleNotices: a dismissal holds along a run, a new run shows again", () => {

  const relay = throttled(15 * 60);
  const [{ key }] = throttleNotices([relay], new Set(), NOW).items;
  const dismissed = new Set([key]);

  assert.deepEqual(throttleNotices([relay], dismissed, NOW).items, []);
  assert.deepEqual(throttleNotices([{ ...relay, throttledUntil: relay.throttledUntil + HOUR }], dismissed, NOW).items, []);
  assert.equal(throttleNotices([{ ...relay, throttledSince: NOW - SECOND }], dismissed, NOW).items.length, 1);
});

test("throttleNotices: allBlocked when every enabled relay is blocked, dismissed or not", () => {

  const a = throttled(30 * 60);
  const b = throttled(20 * 60, 0, { relayUrl: "http://b" });
  const off = { relayUrl: "http://off", disabled: true };
  const healthy = { relayUrl: "http://ok", lastSuccessAt: 1 };

  const all = throttleNotices([a, b, off], new Set(), NOW);

  assert.equal(all.allBlocked, true);
  assert.equal(all.blockedUntil, b.throttledUntil);
  assert.equal(all.nextChangeAt, b.throttledUntil);

  assert.equal(throttleNotices([a, healthy], new Set(), NOW).allBlocked, false);
  assert.equal(throttleNotices([], new Set(), NOW).allBlocked, false);
  assert.equal(throttleNotices([], new Set(), NOW).nextChangeAt, null);

  const [{ key }] = throttleNotices([a], new Set(), NOW).items;
  assert.equal(throttleNotices([a], new Set([key]), NOW).allBlocked, true);
});
