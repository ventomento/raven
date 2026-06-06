
// test/protocol.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  createEncryptedEnvelope,
  decryptEnvelope,
} from "../src/protocol/protocol.js";

import { PrivateIdentity } from "../src/identity/identity.js";
import { PublicIdentity } from "../src/identity/identity.js";

import { Serializer } from "../src/envelope/serializer.js";
import { ContentTypes } from "../src/envelope/content-types.js";

import { exportPublicKeyBytes } from "../src/crypto/x25519.js";

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

test("createEncryptedEnvelope/decryptEnvelope roundtrip", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "envelope api",
    });

  const result =
    await decryptEnvelope({
      identity: bob,
      envelope,
    });

  assert.equal(
    result.plaintext,
    "envelope api"
  );
});

// ============================================================
// SERIALIZATION ROUNDTRIP
// ============================================================

test("serialized envelope roundtrip", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "serialization",
    });

  const packed =
    Serializer.pack(envelope);

  const unpacked =
    Serializer.unpack(packed);

  const result =
    await decryptEnvelope({
      identity: bob,
      envelope: unpacked,
    });

  assert.equal(
    result.plaintext,
    "serialization"
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
// TAMPERING TESTS
// ============================================================

test("tampered ciphertext fails", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const packed = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "hello",
  });

  const tampered =
    new Uint8Array(packed);

  tampered[tampered.length - 1] ^= 0xff;

  await assert.rejects(async () => {
    await decrypt({
      identity: bob,
      envelopeBytes: tampered.buffer,
    });
  });
});

test("tampered auth tag fails", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    auth_tag: envelope.auth_tag.slice(),
  };

  modified.auth_tag[0] ^= 0xff;

  await assert.rejects(async () => {
    await decryptEnvelope({
      identity: bob,
      envelope: modified,
    });
  });
});

test("tampered IV fails", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    aes_gcm_iv: envelope.aes_gcm_iv.slice(),
  };

  modified.aes_gcm_iv[0] ^= 0xff;

  await assert.rejects(async () => {
    await decryptEnvelope({
      identity: bob,
      envelope: modified,
    });
  });
});

// ============================================================
// FORGED SENDER
// ============================================================

test("forged sender public key fails", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const mallory = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  const forged = {
    ...envelope,
    sender_public_key:
      await exportPublicKeyBytes(
        mallory.publicKey
      ),
  };

  await assert.rejects(async () => {
    await decryptEnvelope({
      identity: bob,
      envelope: forged,
    });
  });
});

// ============================================================
// METADATA TAMPERING
// ============================================================

test("uuid modification does not affect decryption", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    uuid: crypto.getRandomValues(
      new Uint8Array(16)
    ),
  };

  const result =
    await decryptEnvelope({
      identity: bob,
      envelope: modified,
    });

  assert.equal(result.plaintext, "hello");
});

test("timestamp modification does not affect decryption", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    timestamp: 0n,
  };

  const result =
    await decryptEnvelope({
      identity: bob,
      envelope: modified,
    });

  assert.equal(result.plaintext, "hello");
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

test("envelope object is frozen", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(bob.publicKey),
      plaintext: "hello",
    });

  assert.ok(
    Object.isFrozen(envelope)
  );
});