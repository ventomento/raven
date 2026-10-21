import test from "node:test";
import assert from "node:assert/strict";

import { relayHealth } from "../../src/relay-health.js";

const NOW = 10_000_000;
const MINUTE = 60 * 1000;

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
