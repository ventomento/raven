
// test/protocol.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  createEnvelope,
  decryptEnvelope,
} from "../src/protocol/protocol.js";

import { PrivateIdentity } from "../src/identity/identity.js";
import { PublicIdentity } from "../src/identity/identity.js";

import { readEnvelope } from "../src/envelope/envelope-reader.js";
import { EnvelopeLayout } from "../src/envelope/layout.js";
import { ContentTypes } from "../src/envelope/content-types.js";

import { exportPublicKeyBytes } from "../src/crypto/x25519.js";

// Byte offsets in a serialized envelope (smep_rfc.txt section 4).
const OFFSET = {
  VERSION: 0,
  UUID: 1,
  SENDER: 17,
  RECIPIENT: 49,
  TIMESTAMP: 81,
  CONTENT_TYPE: 89,
  IV: 94,
  CIPHERTEXT: 106,
};

// alice -> bob envelope bytes.
async function aliceToBob(plaintext = "hello") {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelopeBytes = await createEnvelope({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext,
  });

  return { alice, bob, envelopeBytes };
}

// Copy of buffer with one byte flipped.
function flipByte(buffer, offset) {
  const copy = new Uint8Array(buffer.slice(0));
  copy[offset] ^= 0xff;
  return copy.buffer;
}

// ============================================================
// ROUNDTRIP
// ============================================================

test("encrypt/decrypt roundtrip", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const plaintext = "Hello Bob";

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext,
  });

  const result = await decrypt({
    identity: bob,
    envelopeBytes,
  });

  assert.equal(result.plaintext, plaintext);
  assert.equal(result.contentType, ContentTypes.TEXT_UTF8);

  assert.equal(
    result.senderPublicKeyHex,
    await alice.exportPublicHex()
  );

  assert.equal(
    result.recipientPublicKeyHex,
    await bob.exportPublicHex()
  );

  assert.ok(typeof result.uuid === "string");
  assert.ok(typeof result.timestamp === "number");
});

// ============================================================
// SENDER CAN DECRYPT OWN MESSAGE
// ============================================================

test("sender can decrypt own outbound message", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const plaintext = "message to bob";

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext,
  });

  const result = await decrypt({
    identity: alice,
    envelopeBytes,
  });

  assert.equal(result.plaintext, plaintext);
});

// ============================================================
// UNIQUE ENCRYPTION
// ============================================================

test("same plaintext encrypts differently", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const recipient =
    new PublicIdentity(bob.publicKey);

  const a = await encrypt({
    sender: alice,
    recipient,
    plaintext: "same message",
  });

  const b = await encrypt({
    sender: alice,
    recipient,
    plaintext: "same message",
  });

  assert.notDeepEqual(
    Buffer.from(a),
    Buffer.from(b)
  );
});

// ============================================================
// WRONG IDENTITY
// ============================================================

test("unrelated identity cannot decrypt", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const eve = await PrivateIdentity.generate();

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "secret",
  });

  await assert.rejects(async () => {
    await decrypt({
      identity: eve,
      envelopeBytes,
    });
  });
});

// ============================================================
// ENVELOPE API
// ============================================================

test("createEnvelope/decryptEnvelope roundtrip", async () => {
  const { bob, envelopeBytes } = await aliceToBob("envelope api");

  assert.ok(envelopeBytes instanceof ArrayBuffer);

  const result =
    await decryptEnvelope({
      identity: bob,
      envelope: readEnvelope(envelopeBytes),
    });

  assert.equal(
    result.plaintext,
    "envelope api"
  );
});

// ============================================================
// BINARY PAYLOAD
// ============================================================

test("binary payload roundtrip", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const payload = new Uint8Array([
    0x00,
    0x01,
    0x02,
    0xff,
    0xaa,
    0x55,
  ]);

  const BINARY_TYPE = 2;

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: payload,
    contentType: BINARY_TYPE,
  });

  const result = await decrypt({
    identity: bob,
    envelopeBytes,
  });

  assert.ok(
    result.plaintext instanceof Uint8Array
  );

  assert.deepEqual(
    Array.from(result.plaintext),
    Array.from(payload)
  );
});

// ============================================================
// SIZE LIMIT
// ============================================================

// Largest plaintext: 4 MiB minus header, iv and tag.
const MAX_PLAINTEXT =
  EnvelopeLayout.MAX_SIZE - EnvelopeLayout.HEADER_SIZE - EnvelopeLayout.SIZES.MIN_PAYLOAD;

test("encrypt accepts the largest plaintext and rejects one byte more", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const recipient = new PublicIdentity(bob.publicKey);

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient,
    plaintext: new Uint8Array(MAX_PLAINTEXT),
    contentType: ContentTypes.FILE,
  });

  assert.equal(envelopeBytes.byteLength, EnvelopeLayout.MAX_SIZE);

  await assert.rejects(
    encrypt({
      sender: alice,
      recipient,
      plaintext: new Uint8Array(MAX_PLAINTEXT + 1),
      contentType: ContentTypes.FILE,
    }),
    /too large/
  );
});

// ============================================================
// TAMPERING TESTS
// ============================================================

// Every byte except the version is authenticated: the header as AAD,
// the payload by the tag. (A changed version fails to parse.)
const tamperCases = [
  ["uuid", OFFSET.UUID],
  ["sender public key", OFFSET.SENDER],
  ["recipient public key", OFFSET.RECIPIENT],
  ["timestamp", OFFSET.TIMESTAMP + 7],
  ["content type", OFFSET.CONTENT_TYPE],
  ["IV", OFFSET.IV],
  ["ciphertext", OFFSET.CIPHERTEXT],
  ["auth tag", -1],
];

for (const [name, offset] of tamperCases) {
  test(`tampered ${name} fails`, async () => {
    const { bob, envelopeBytes } = await aliceToBob();

    const position =
      offset < 0 ? envelopeBytes.byteLength + offset : offset;

    await assert.rejects(
      decrypt({
        identity: bob,
        envelopeBytes: flipByte(envelopeBytes, position),
      })
    );
  });
}

test("forged sender public key fails", async () => {
  const { bob, envelopeBytes } = await aliceToBob();
  const mallory = await PrivateIdentity.generate();

  const forged = new Uint8Array(envelopeBytes.slice(0));

  forged.set(
    await exportPublicKeyBytes(mallory.publicKey),
    OFFSET.SENDER
  );

  await assert.rejects(
    decrypt({
      identity: bob,
      envelopeBytes: forged.buffer,
    })
  );
});

test("read header is the envelope's first bytes", async () => {
  const { envelopeBytes } = await aliceToBob();

  assert.deepEqual(
    readEnvelope(envelopeBytes).header,
    new Uint8Array(envelopeBytes, 0, EnvelopeLayout.HEADER_SIZE)
  );
});

// ============================================================
// STRUCTURE TESTS
// ============================================================

test("truncated serialized envelope fails", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const packed = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "hello",
  });

  const truncated =
    packed.slice(
      0,
      packed.byteLength - 8
    );

  await assert.rejects(async () => {
    await decrypt({
      identity: bob,
      envelopeBytes: truncated,
    });
  });
});

test("random garbage fails", async () => {
  const garbage =
    crypto.getRandomValues(
      new Uint8Array(128)
    );

  await assert.rejects(async () => {
    await decrypt({
      identity:
        await PrivateIdentity.generate(),
      envelopeBytes:
        garbage.buffer,
    });
  });
});

test("ArrayBuffer plaintext roundtrip", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelopeBytes = await createEnvelope({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: new Uint8Array([1, 2, 3]).buffer,
    contentType: ContentTypes.FILE,
  });

  const result = await decrypt({
    identity: bob,
    envelopeBytes,
  });

  assert.deepEqual(Array.from(result.plaintext), [1, 2, 3]);
});
