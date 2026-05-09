// test/protocol.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  createEncryptedEnvelope,
  decryptEnvelope,
} from "../src/protocol/protocol.js";

import {
  PublicIdentity,
  PrivateIdentity,
} from "../src/identity/identity.js";

import { Serializer } from "../src/envelope/serializer.js";
import { ContentTypes } from "../src/envelope/content-types.js";

// ============================================================
// ROUNDTRIP
// ============================================================

test("encrypt -> decrypt roundtrip (TEXT_UTF8)", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const plaintext =
    "hello encrypted world";

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext,
  });

  assert.ok(
    encrypted instanceof ArrayBuffer
  );

  const result = await decrypt({
    recipient,
    encrypted,
  });

  assert.equal(
    result.plaintext,
    plaintext
  );

  assert.equal(
    result.contentType,
    ContentTypes.TEXT_UTF8
  );

  assert.equal(
    result.senderPublicKeyHex,
    await sender.exportPublicHex()
  );
});

// ============================================================
// ENVELOPE LAYER ROUNDTRIP
// ============================================================

test("createEncryptedEnvelope -> decryptEnvelope", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "envelope payload",
    });

  const result =
    await decryptEnvelope({
      recipient,
      envelope,
    });

  assert.equal(
    result.plaintext,
    "envelope payload"
  );
});

// ============================================================
// ENVELOPE STRUCTURE VALIDATION
// ============================================================

test("encrypted message produces valid envelope", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "payload test",
  });

  const envelope =
    Serializer.unpack(encrypted);

  assert.equal(
    envelope.version,
    Serializer.VERSION
  );

  assert.equal(
    envelope.uuid.length,
    Serializer.SIZES.UUID
  );

  assert.equal(
    envelope.sender_public_key.length,
    Serializer.SIZES.PUBKEY
  );

  assert.equal(
    envelope.recipient_public_key.length,
    Serializer.SIZES.PUBKEY
  );

  assert.equal(
    envelope.aes_gcm_iv.length,
    Serializer.SIZES.NONCE
  );

  assert.equal(
    envelope.auth_tag.length,
    Serializer.SIZES.TAG
  );

  assert.ok(
    envelope.ciphertext.length > 0
  );

  const expectedPayloadSize =
    Serializer.SIZES.NONCE +
    envelope.ciphertext.length +
    Serializer.SIZES.TAG;

  assert.equal(
    envelope.payload_size,
    expectedPayloadSize
  );
});

// ============================================================
// WRONG RECIPIENT
// ============================================================

test("decrypt fails with wrong recipient", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const wrongRecipient =
    await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "top secret message",
  });

  await assert.rejects(async () => {
    await decrypt({
      recipient:
        wrongRecipient,
      encrypted,
    });
  });
});

// ============================================================
// TAMPER DETECTION
// ============================================================

test("tampered ciphertext fails authentication", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "authenticated payload",
  });

  const bytes =
    new Uint8Array(encrypted);

  bytes[bytes.length - 1] ^= 0xff;

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted,
    });
  });
});

// ============================================================
// CONTENT TYPES
// ============================================================

test("supports IMAGE content type", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const imageBytes =
    new TextEncoder().encode(
      "fake-image-data"
    );

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      imageBytes,
    contentType:
      ContentTypes.IMAGE,
  });

  const result =
    await decrypt({
      recipient,
      encrypted,
    });

  assert.equal(
    result.contentType,
    ContentTypes.IMAGE
  );

  assert.deepEqual(
    result.plaintext,
    imageBytes
  );
});

// ============================================================
// TIMESTAMP VALIDATION
// ============================================================

test("timestamp is recent", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const before =
    BigInt(
      Math.floor(Date.now() / 1000)
    );

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "time test",
  });

  const after =
    BigInt(
      Math.floor(Date.now() / 1000)
    );

  const envelope =
    Serializer.unpack(encrypted);

  assert.ok(
    envelope.timestamp >= before
  );

  assert.ok(
    envelope.timestamp <= after
  );
});

// ============================================================
// IMMUTABILITY
// ============================================================

test("decrypt result is frozen", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "immutable result",
  });

  const result =
    await decrypt({
      recipient,
      encrypted,
    });

  assert.ok(
    Object.isFrozen(result)
  );

  assert.throws(() => {
    result.plaintext = "hacked";
  });
});

// ============================================================
// INVALID ENVELOPE
// ============================================================

test("rejects truncated envelope", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender,
    recipient:
      new PublicIdentity(
        recipient.publicKey
      ),
    plaintext:
      "truncate me",
  });

  const truncated =
    encrypted.slice(
      0,
      encrypted.byteLength - 1
    );

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted:
        truncated,
    });
  });
});