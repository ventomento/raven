import test from "node:test";
import assert from "node:assert/strict";

import { EnvelopeLayout } from "../../../smep/src/index.js";
import {
    SmerpHeaders,
    Status,
    MAX_ENVELOPE_BYTES,
    MAX_BATCH_BYTES,
    MAX_RESPONSE_BYTES,
    encodeBatch,
    decodeBatch,
    parseCursor,
} from "../../src/protocol/index.js";

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

test("parseCursor rejects an integer beyond the safe range", () => {

    assert.throws(() => parseCursor("9007199254740993", 0), /invalid cursor/);
});

test("encodeBatch rejects an envelope that is not bytes", () => {

    assert.throws(() => encodeBatch(["text"]), TypeError);
});

// ============================================================
// CONSTANTS
// ============================================================

test("header names are lowercase, as Node and fetch report them", () => {

    for (const name of Object.values(SmerpHeaders)) {
        assert.equal(name, name.toLowerCase());
    }
});

test("size limits are 4 MiB and the envelope limit is smep's", () => {

    assert.equal(MAX_ENVELOPE_BYTES, EnvelopeLayout.MAX_SIZE);
    assert.equal(MAX_BATCH_BYTES, 4 * 1024 * 1024);
    assert.deepEqual(
        [Status.OK, Status.NO_CONTENT, Status.BAD_REQUEST, Status.UNAUTHORIZED, Status.TOO_MANY_REQUESTS],
        [200, 204, 400, 401, 429]
    );
});

test("MAX_RESPONSE_BYTES holds a full batch of the smallest envelopes, framing included", () => {

    const smallest = EnvelopeLayout.HEADER_SIZE + EnvelopeLayout.SIZES.MIN_PAYLOAD;
    const count = Math.floor(MAX_BATCH_BYTES / smallest);

    assert.equal(MAX_RESPONSE_BYTES, MAX_BATCH_BYTES + 4 * count);
    assert.ok(MAX_RESPONSE_BYTES >= count * (4 + smallest));
    assert.ok(MAX_RESPONSE_BYTES >= 4 + MAX_ENVELOPE_BYTES);
});
