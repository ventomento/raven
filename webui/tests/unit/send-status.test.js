import test from "node:test";
import assert from "node:assert/strict";

import { DispatchError, RelayThrottledError } from "../../../index.js";
import { formatTime } from "../../src/format.js";
import { describeSendFailure, describeSendResult } from "../../src/send-status.js";

const NOW = 1_800_000_000_000;
const UNTIL = NOW + 60 * 60 * 1000;
const at = formatTime(UNTIL, NOW);

const throttled = (relayUrl) => ({ relayUrl, error: new RelayThrottledError(relayUrl, UNTIL) });

test("one throttled relay: says who and until when", () => {

  assert.equal(
    describeSendFailure(new DispatchError([throttled("http://a")]), NOW),
    `Not sent. http://a is rate limiting you until ${at}.`
  );
});

test("several relays: one reason each, throttled or not", () => {

  const error = new DispatchError([throttled("http://a"), { relayUrl: "http://b", error: new Error("connection failed") }]);

  assert.equal(describeSendFailure(error, NOW), `Not sent. http://a: rate limited until ${at}; http://b: connection failed.`);
});

test("other errors keep their message", () => {

  assert.equal(describeSendFailure(new Error("nope"), NOW), "nope");
  assert.equal(describeSendFailure(new DispatchError([]), NOW), "no relays configured");
});

test("partly delivered: names the throttled relay only", () => {

  assert.equal(
    describeSendResult({ delivered: ["http://a"], failed: [] }, NOW),
    "Sent to 1 of 1 relays."
  );
  assert.equal(
    describeSendResult({ delivered: ["http://a"], failed: [throttled("http://b")] }, NOW),
    `Sent to 1 of 2 relays. http://b is rate limiting you until ${at}.`
  );
  assert.equal(
    describeSendResult({ delivered: ["http://a"], failed: [{ relayUrl: "http://b", error: new Error("x") }] }, NOW),
    "Sent to 1 of 2 relays."
  );
});
