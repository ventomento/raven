import test from "node:test";
import assert from "node:assert/strict";

import {
    encodeBatch,
    decodeBatch,
    parseCursor,
    retryAfterMs,
    getEnvelopes,
    postEnvelope,
} from "../src/protocol/index.js";

const bytes = (...values) => new Uint8Array(values);
const asArray = (buffer) => Array.from(new Uint8Array(buffer));

// ============================================================
// BATCH CODEC
// ============================================================

test("a batch round-trips, each frame as its own ArrayBuffer", () => {

    const body = encodeBatch([bytes(1, 2, 3), bytes(4).buffer, bytes()]);

    assert.equal(body.byteLength, 3 * 4 + 4);

    const { frames, error } = decodeBatch(body);

    assert.equal(error, null);
    assert.deepEqual(frames.map(asArray), [[1, 2, 3], [4], []]);
    assert.ok(frames.every(frame => frame instanceof ArrayBuffer));
});

test("lengths are uint32 big-endian", () => {

    assert.deepEqual(Array.from(encodeBatch([bytes(9, 9)])), [0, 0, 0, 2, 9, 9]);
});

test("decodes a Uint8Array view at an offset", () => {

    const backing = new Uint8Array(10);
    backing.set(encodeBatch([bytes(7, 8)]), 2);

    const { frames, error } = decodeBatch(backing.subarray(2, 8));

    assert.equal(error, null);
    assert.deepEqual(frames.map(asArray), [[7, 8]]);
});

test("a frame running past the end keeps the frames before it", () => {

    const body = encodeBatch([bytes(1), bytes(2, 3)]);

    const { frames, error } = decodeBatch(body.subarray(0, body.byteLength - 1));

    assert.deepEqual(frames.map(asArray), [[1]]);
    assert.match(error, /past the end/);
});

test("a trailing partial length is a framing error", () => {

    const body = new Uint8Array([...encodeBatch([bytes(1)]), 0, 0]);

    const { frames, error } = decodeBatch(body);

    assert.deepEqual(frames.map(asArray), [[1]]);
    assert.match(error, /inside a frame length/);
});

test("an empty body is a framing error", () => {

    const { frames, error } = decodeBatch(new ArrayBuffer(0));

    assert.deepEqual(frames, []);
    assert.match(error, /no envelope/);
});

test("decodeBatch rejects a body that is not bytes", () => {

    assert.throws(() => decodeBatch("text"), TypeError);
});

// ============================================================
// CURSOR
// ============================================================

test("parseCursor accepts an integer above the requested cursor", () => {

    assert.equal(parseCursor("5", 0), 5);
    assert.equal(parseCursor("6", 5), 6);
});

test("parseCursor rejects a missing, non-integer or regressing cursor", () => {

    assert.throws(() => parseCursor(undefined, 0), /invalid cursor/);
    assert.throws(() => parseCursor("abc", 0), /invalid cursor/);
    assert.throws(() => parseCursor("1.5", 0), /invalid cursor/);
    assert.throws(() => parseCursor("", 0), /cursor regression/);
    assert.throws(() => parseCursor("5", 5), /cursor regression/);
    assert.throws(() => parseCursor("4", 5), /cursor regression/);
});

// ============================================================
// RETRY-AFTER
// ============================================================

test("retryAfterMs reads seconds or a date, defaults otherwise", () => {

    const now = Date.parse("2026-01-01T00:00:00Z");

    assert.equal(retryAfterMs({ "retry-after": "30" }, now), 30 * 1000);
    assert.equal(retryAfterMs({ "retry-after": "Thu, 01 Jan 2026 00:01:00 GMT" }, now), 60 * 1000);
    assert.equal(retryAfterMs({ "retry-after": "soon" }, now), 5000);
    assert.equal(retryAfterMs({}, now), 5000);
});

// ============================================================
// REQUESTS
// ============================================================

test("requests carry the target relative to the relay URL", () => {

    assert.deepEqual(getEnvelopes(12), { method: "GET", target: "/envelopes?cursor=12" });

    const body = bytes(1);
    const post = postEnvelope(body);

    assert.equal(post.method, "POST");
    assert.equal(post.target, "/envelopes");
    assert.equal(post.body, body);
    assert.equal(post.headers["content-type"], "application/octet-stream");
});
