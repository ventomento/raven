// test/serializer.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { Serializer } from "../src/envelope/serializer.js";

function randomBytes(length) {
  const arr = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    arr[i] = (Math.random() * 256) | 0;
  }

  return arr;
}

function createValidObject(ciphertextLength = 64) {
  return {
    uuid: randomBytes(Serializer.SIZES.UUID),

    sender_public_key: randomBytes(
      Serializer.SIZES.PUBKEY
    ),

    recipient_public_key: randomBytes(
      Serializer.SIZES.PUBKEY
    ),

    timestamp: 1234567890123456789n,

    content_type: 7,

    aes_gcm_iv: randomBytes(
      Serializer.SIZES.NONCE
    ),

    ciphertext: randomBytes(ciphertextLength),

    auth_tag: randomBytes(
      Serializer.SIZES.TAG
    ),
  };
}

test("pack -> unpack roundtrip", () => {
  const original = createValidObject(128);

  const buffer = Serializer.pack(original);

  assert.ok(buffer instanceof ArrayBuffer);

  const unpacked = Serializer.unpack(buffer);

  assert.equal(unpacked.version, Serializer.VERSION);

  assert.deepEqual(
    unpacked.uuid,
    original.uuid
  );

  assert.deepEqual(
    unpacked.sender_public_key,
    original.sender_public_key
  );

  assert.deepEqual(
    unpacked.recipient_public_key,
    original.recipient_public_key
  );

  assert.equal(
    unpacked.timestamp,
    original.timestamp
  );

  assert.equal(
    unpacked.content_type,
    original.content_type
  );

  assert.deepEqual(
    unpacked.aes_gcm_iv,
    original.aes_gcm_iv
  );

  assert.deepEqual(
    unpacked.ciphertext,
    original.ciphertext
  );

  assert.deepEqual(
    unpacked.auth_tag,
    original.auth_tag
  );

  const expectedPayloadSize =
    Serializer.SIZES.NONCE +
    original.ciphertext.length +
    Serializer.SIZES.TAG;

  assert.equal(
    unpacked.payload_size,
    expectedPayloadSize
  );
});

test("minimum valid payload", () => {
  const original = createValidObject(0);

  const buffer = Serializer.pack(original);

  const unpacked = Serializer.unpack(buffer);

  assert.equal(
    unpacked.payload_size,
    Serializer.SIZES.MIN_PAYLOAD
  );

  assert.equal(
    unpacked.ciphertext.length,
    0
  );
});

test("rejects invalid version", () => {
  const original = createValidObject();

  const buffer = Serializer.pack(original);

  const bytes = new Uint8Array(buffer);

  bytes[0] = 0xff;

  assert.throws(() => {
    Serializer.unpack(buffer);
  }, /Invalid version/);
});

test("rejects truncated buffer", () => {
  const original = createValidObject();

  const buffer = Serializer.pack(original);

  const truncated = buffer.slice(
    0,
    buffer.byteLength - 1
  );

  assert.throws(() => {
    Serializer.unpack(truncated);
  });
});

test("rejects invalid uuid length", () => {
  const original = createValidObject();

  original.uuid = randomBytes(15);

  assert.throws(() => {
    Serializer.pack(original);
  }, /uuid must be 16 bytes/);
});

test("rejects invalid timestamp type", () => {
  const original = createValidObject();

  original.timestamp = 123;

  assert.throws(() => {
    Serializer.pack(original);
  }, /timestamp must be uint64/);
});

test("rejects invalid content_type", () => {
  const original = createValidObject();

  original.content_type = 256;

  assert.throws(() => {
    Serializer.pack(original);
  }, /content_type must be uint8/);
});

test("unpacked object is frozen", () => {
  const original = createValidObject();

  const buffer = Serializer.pack(original);

  const unpacked = Serializer.unpack(buffer);

  assert.ok(Object.isFrozen(unpacked));

  assert.throws(() => {
    unpacked.version = 99;
  });
});

test("rejects payload smaller than minimum", () => {
  const original = createValidObject();

  const buffer = Serializer.pack(original);

  const bytes = new Uint8Array(buffer);

  // payload_size offset:
  // 1 + 16 + 32 + 32 + 8 + 1 = 90
  // u32 starts at 90
  const payloadSizeOffset = 90;

  const view = new DataView(buffer);

  view.setUint32(
    payloadSizeOffset,
    Serializer.SIZES.MIN_PAYLOAD - 1,
    false
  );

  assert.throws(() => {
    Serializer.unpack(buffer);
  }, /payload_size too small/);
});