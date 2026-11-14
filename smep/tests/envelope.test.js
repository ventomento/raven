import test from "node:test";
import assert from "node:assert/strict";

import { EnvelopeWriter } from "../src/envelope/envelope-writer.js";
import { readEnvelope } from "../src/envelope/envelope-reader.js";
import { EnvelopeLayout } from "../src/envelope/layout.js";

const { HEADER_SIZE, MAX_SIZE, SIZES } = EnvelopeLayout;

const PAYLOAD_SIZE_OFFSET = 74;

function randomBytes(length) {
  const arr = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    arr[i] = (Math.random() * 256) | 0;
  }

  return arr;
}

function createHeaderFields() {
  return {
    sender_public_key: randomBytes(SIZES.PUBKEY),
    recipient_public_key: randomBytes(SIZES.PUBKEY),
    timestamp: 1234567890123456789n,
    content_type: 7,
  };
}

function createBody(ciphertextLength = 64) {
  return {
    aes_gcm_iv: randomBytes(SIZES.NONCE),
    ciphertext_with_tag: randomBytes(ciphertextLength + SIZES.TAG),
  };
}

function writeEnvelope(fields, body) {
  const ciphertextLength = body.ciphertext_with_tag.length - SIZES.TAG;
  const writer = new EnvelopeWriter(EnvelopeWriter.size(ciphertextLength));

  writer.writeHeader(fields);
  writer.writeBody(body);

  return writer.finish();
}

function newWriter(ciphertextLength = 64) {
  return new EnvelopeWriter(EnvelopeWriter.size(ciphertextLength));
}

test("write -> read roundtrip", () => {
  const fields = createHeaderFields();
  const body = createBody(128);

  const buffer = writeEnvelope(fields, body);

  assert.ok(buffer instanceof ArrayBuffer);

  const envelope = readEnvelope(buffer);

  assert.equal(envelope.version, EnvelopeLayout.VERSION);
  assert.deepEqual(envelope.sender_public_key, fields.sender_public_key);
  assert.deepEqual(envelope.recipient_public_key, fields.recipient_public_key);
  assert.equal(envelope.timestamp, fields.timestamp);
  assert.equal(envelope.content_type, fields.content_type);
  assert.deepEqual(envelope.aes_gcm_iv, body.aes_gcm_iv);
  assert.deepEqual(envelope.ciphertext_with_tag, body.ciphertext_with_tag);

  assert.deepEqual(
    envelope.header,
    new Uint8Array(buffer, 0, HEADER_SIZE)
  );

  assert.equal(
    envelope.payload_size,
    SIZES.NONCE + body.ciphertext_with_tag.length
  );
});

test("minimum valid payload", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody(0));

  const envelope = readEnvelope(buffer);

  assert.equal(envelope.payload_size, SIZES.MIN_PAYLOAD);
  assert.equal(envelope.ciphertext_with_tag.length, SIZES.TAG);
});

test("read envelope is frozen", () => {
  const envelope = readEnvelope(
    writeEnvelope(createHeaderFields(), createBody())
  );

  assert.ok(Object.isFrozen(envelope));

  assert.throws(() => {
    envelope.version = 99;
  });
});

test("writeHeader returns the header bytes of the final envelope", () => {
  const writer = newWriter(32);

  const header = writer.writeHeader(createHeaderFields());

  assert.equal(header.length, HEADER_SIZE);

  const headerCopy = header.slice();

  writer.writeBody(createBody(32));

  assert.deepEqual(
    new Uint8Array(writer.finish(), 0, HEADER_SIZE),
    headerCopy
  );
});

test("writeHeader takes payload_size from the buffer size", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody(10));

  assert.equal(
    new DataView(buffer).getUint32(PAYLOAD_SIZE_OFFSET, false),
    buffer.byteLength - HEADER_SIZE
  );
});

test("size() rejects a negative or non-integer length", () => {
  assert.throws(() => EnvelopeWriter.size(-1));
  assert.throws(() => EnvelopeWriter.size(1.5));
});

test("constructor rejects a size below the minimum envelope", () => {
  assert.throws(
    () => new EnvelopeWriter(HEADER_SIZE + SIZES.MIN_PAYLOAD - 1),
    /byteSize too small/
  );
});

test("writeBody before writeHeader throws", () => {
  assert.throws(
    () => newWriter().writeBody(createBody()),
    /writeBody called out of order/
  );
});

test("writeHeader twice throws", () => {
  const writer = newWriter();

  writer.writeHeader(createHeaderFields());

  assert.throws(
    () => writer.writeHeader(createHeaderFields()),
    /writeHeader called out of order/
  );
});

test("finish without body throws", () => {
  const writer = newWriter();

  writer.writeHeader(createHeaderFields());

  assert.throws(() => writer.finish(), /did not fill buffer/);
});

test("writeBody rejects a body of the wrong length", () => {
  const writer = newWriter(31);

  writer.writeHeader(createHeaderFields());

  assert.throws(
    () => writer.writeBody(createBody(32)),
    /ciphertext_with_tag must be 47 bytes/
  );
});


test("rejects invalid timestamp type", () => {
  const fields = createHeaderFields();

  fields.timestamp = 123;

  assert.throws(
    () => newWriter().writeHeader(fields),
    /timestamp must be uint64/
  );
});

test("rejects invalid content_type", () => {
  const fields = createHeaderFields();

  fields.content_type = 256;

  assert.throws(
    () => newWriter().writeHeader(fields),
    /content_type must be uint8/
  );
});

test("rejects invalid version", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody());

  new Uint8Array(buffer)[0] = 0xff;

  assert.throws(() => readEnvelope(buffer), /Invalid version/);
});

test("rejects truncated buffer", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody());

  assert.throws(() => {
    readEnvelope(buffer.slice(0, buffer.byteLength - 1));
  });
});

test("rejects trailing bytes", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody());

  const extended = new Uint8Array(buffer.byteLength + 1);
  extended.set(new Uint8Array(buffer));

  assert.throws(() => readEnvelope(extended.buffer), /Total size mismatch/);
});

test("rejects payload smaller than minimum", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody());

  new DataView(buffer).setUint32(
    PAYLOAD_SIZE_OFFSET,
    SIZES.MIN_PAYLOAD - 1,
    false
  );

  assert.throws(() => readEnvelope(buffer), /payload_size too small/);
});

const MAX_CIPHERTEXT = MAX_SIZE - HEADER_SIZE - SIZES.MIN_PAYLOAD;

test("an envelope of exactly the maximum size is written and read", () => {
  const buffer = writeEnvelope(createHeaderFields(), createBody(MAX_CIPHERTEXT));

  assert.equal(buffer.byteLength, MAX_SIZE);
  assert.equal(readEnvelope(buffer).payload_size, MAX_SIZE - HEADER_SIZE);
});

test("size() and the constructor reject an envelope over the maximum", () => {
  assert.throws(() => EnvelopeWriter.size(MAX_CIPHERTEXT + 1), /too large/);
  assert.throws(() => new EnvelopeWriter(MAX_SIZE + 1), /too large/);
});

test("rejects an envelope over the maximum size", () => {
  const buffer = new ArrayBuffer(MAX_SIZE + 1);
  const bytes = new Uint8Array(buffer);

  bytes[0] = EnvelopeLayout.VERSION;
  new DataView(buffer).setUint32(PAYLOAD_SIZE_OFFSET, MAX_SIZE + 1 - HEADER_SIZE, false);

  assert.throws(() => readEnvelope(buffer), /too large/);
});
