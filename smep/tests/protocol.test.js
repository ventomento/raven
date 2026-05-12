// test/protocol.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  PrivateIdentity,
  PublicIdentity,
  createEncryptedEnvelope,
  decryptEnvelope,
} from "../src/protocol/protocol.js";

import {
  importPublicKey,
  exportPublicKeyBytes,
} from "../src/crypto/x25519.js";

import { Serializer } from "../src/envelope/serializer.js";
import { ContentTypes } from "../src/envelope/content-types.js";

test("encrypt/decrypt round trip", async () => {

  // Generate identities
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  // Bob public identity
  const bobPublic = new PublicIdentity(
    bob.publicKey
  );

  const message =
    "Hello Bob, this is a secret message.";

  // Encrypt
  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: bobPublic,
    plaintext: message,
    contentType: ContentTypes.TEXT_UTF8,
  });

  // Decrypt
  const result = await decrypt({
    recipient: bob,
    envelopeBytes,
  });

  // Assertions
  assert.equal(
    result.plaintext,
    message,
    "decrypted plaintext should match original"
  );

  assert.equal(
    result.contentType,
    ContentTypes.TEXT_UTF8
  );

  assert.ok(
    typeof result.senderPublicKeyHex === "string"
  );

  assert.ok(
    typeof result.recipientPublicKeyHex === "string"
  );

  assert.ok(
    typeof result.uuid === "string"
  );
});

test("different ciphertexts for same plaintext", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const bobPublic = new PublicIdentity(
    bob.publicKey
  );

  const plaintext = "same message";

  const encrypted1 = await encrypt({
    sender: alice,
    recipient: bobPublic,
    plaintext,
  });

  const encrypted2 = await encrypt({
    sender: alice,
    recipient: bobPublic,
    plaintext,
  });

  // AES-GCM IV should make ciphertext unique
  assert.notDeepEqual(
    Buffer.from(encrypted1),
    Buffer.from(encrypted2)
  );
});

test("decrypt fails with wrong recipient", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const eve = await PrivateIdentity.generate();

  const bobPublic = new PublicIdentity(
    bob.publicKey
  );

  const envelopeBytes = await encrypt({
    sender: alice,
    recipient: bobPublic,
    plaintext: "top secret",
  });

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: eve,
        envelopeBytes,
      });
    }
  );
});

// test/protocol.security.test.js

// ============================================================
// BASIC SECURITY / CORRUPTION TESTS
// ============================================================

test("tampered ciphertext should fail authentication", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const bobPublic = new PublicIdentity(
    bob.publicKey
  );

  const encrypted = await encrypt({
    sender: alice,
    recipient: bobPublic,
    plaintext: "authenticated message",
  });

  // Corrupt one byte
  const tampered = new Uint8Array(encrypted);
  tampered[tampered.length - 1] ^= 0xff;

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: bob,
        envelopeBytes: tampered.buffer,
      });
    }
  );
});

test("tampered auth tag should fail authentication", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope = await createEncryptedEnvelope({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "hello",
  });

  envelope.auth_tag[0] ^= 0xff;

  await assert.rejects(
    async () => {
      await decryptEnvelope({
        recipient: bob,
        envelope,
      });
    }
  );
});

test("tampered IV should fail authentication", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope = await createEncryptedEnvelope({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "hello",
  });

  envelope.aes_gcm_iv[0] ^= 0xff;

  await assert.rejects(
    async () => {
      await decryptEnvelope({
        recipient: bob,
        envelope,
      });
    }
  );
});

// ============================================================
// WRONG IDENTITY TESTS
// ============================================================

test("wrong recipient cannot decrypt", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const mallory = await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(bob.publicKey),
    plaintext: "secret",
  });

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: mallory,
        envelopeBytes: encrypted,
      });
    }
  );
});

// ============================================================
// FORGED SENDER TEST (FIXED)
// ============================================================

test("forged sender public key should fail decryption", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const mallory = await PrivateIdentity.generate();

  const originalEnvelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello bob",
    });

  // Clone frozen envelope
  const forgedEnvelope = {
    ...originalEnvelope,
    sender_public_key:
      await exportPublicKeyBytes(
        mallory.publicKey
      ),
  };

  await assert.rejects(
    async () => {
      await decryptEnvelope({
        recipient: bob,
        envelope: forgedEnvelope,
      });
    }
  );
});


// ============================================================
// INVALID KEY TESTS
// ============================================================

test("PublicIdentity rejects non-public CryptoKey", async () => {

  const alice = await PrivateIdentity.generate();

  assert.throws(() => {
    new PublicIdentity(
      alice.privateKey
    );
  });
});

test("PrivateIdentity rejects swapped key types", async () => {

  const alice = await PrivateIdentity.generate();

  assert.throws(() => {
    new PrivateIdentity({
      privateKey: alice.publicKey,
      publicKey: alice.privateKey,
    });
  });
});

test("fromPublicHex rejects malformed public key", async () => {

  await assert.rejects(
    async () => {
      await PublicIdentity.fromPublicHex(
        "deadbeef"
      );
    }
  );
});

test("fromPrivateHex rejects malformed private key", async () => {

  await assert.rejects(
    async () => {
      await PrivateIdentity.fromPrivateHex(
        "cafebabe"
      );
    }
  );
});

// ============================================================
// SMALL SUBGROUP / LOW ORDER POINT TESTS
// ============================================================

// X25519 low-order public keys from RFC 7748 style attack cases.
// Depending on implementation, import may fail OR
// deriveSharedSecret may fail OR AES auth may fail.
// Any outcome is acceptable EXCEPT successful decrypt.

test("low-order public key attack should fail", async () => {

  const victim = await PrivateIdentity.generate();

  // All-zero X25519 public key
  const lowOrder =
    new Uint8Array(32);

  let imported;

  try {

    imported = await importPublicKey(
      lowOrder
    );

  } catch {

    // GOOD:
    // implementation rejected invalid key
    return;
  }

  const attacker =
    new PublicIdentity(imported);

  await assert.rejects(
    async () => {

      await encrypt({
        sender: victim,
        recipient: attacker,
        plaintext: "test",
      });

    }
  );
});

// ============================================================
// SERIALIZATION TESTS
// ============================================================

test("serialized envelope roundtrip preserves plaintext", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "serialization test",
    });

  const packed =
    Serializer.pack(envelope);

  const unpacked =
    Serializer.unpack(packed);

  const result =
    await decryptEnvelope({
      recipient: bob,
      envelope: unpacked,
    });

  assert.equal(
    result.plaintext,
    "serialization test"
  );
});

// ============================================================
// BINARY PAYLOAD ROUNDTRIP (FIXED)
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

  // IMPORTANT:
  // Use a non-text content type.
  // Replace this with your actual binary enum.
  const BINARY_TYPE = 2;

  const encrypted = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(
      bob.publicKey
    ),
    plaintext: payload,
    contentType: BINARY_TYPE,
  });

  const result = await decrypt({
    recipient: bob,
    envelopeBytes: encrypted,
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
// IMMUTABILITY TESTS
// ============================================================

test("PublicIdentity is frozen", async () => {

  const alice = await PrivateIdentity.generate();

  const pub = new PublicIdentity(
    alice.publicKey
  );

  assert.ok(
    Object.isFrozen(pub)
  );
});

test("PrivateIdentity is frozen", async () => {

  const alice = await PrivateIdentity.generate();

  assert.ok(
    Object.isFrozen(alice)
  );
});

// ============================================================
// LENGTH / TRUNCATION / STRUCTURE TAMPERING TESTS
// ============================================================

// ============================================================
// TRUNCATED SERIALIZED ENVELOPE
// ============================================================

test("truncated envelope should fail unpack/decrypt", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(
      bob.publicKey
    ),
    plaintext: "hello world",
  });

  // Remove bytes from end
  const truncated =
    encrypted.slice(
      0,
      encrypted.byteLength - 8
    );

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: bob,
        envelopeBytes: truncated,
      });
    }
  );
});

// ============================================================
// EXTRA TRAILING BYTES
// ============================================================

test("extra trailing bytes should fail", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const encrypted = await encrypt({
    sender: alice,
    recipient: new PublicIdentity(
      bob.publicKey
    ),
    plaintext: "hello",
  });

  const original =
    new Uint8Array(encrypted);

  const extended =
    new Uint8Array(
      original.length + 32
    );

  extended.set(original);

  // Garbage suffix
  extended.fill(
    0xaa,
    original.length
  );

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: bob,
        envelopeBytes: extended.buffer,
      });
    }
  );
});

// ============================================================
// CIPHERTEXT LENGTH MISMATCH
// ============================================================

test("ciphertext truncation should fail authentication", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext:
        "this message will be truncated",
    });

  const modified = {
    ...envelope,

    ciphertext:
      envelope.ciphertext.slice(
        0,
        envelope.ciphertext.length - 4
      ),
  };

  const packed =
    Serializer.pack(modified);

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: bob,
        envelopeBytes: packed,
      });
    }
  );
});

// ============================================================
// AUTH TAG LENGTH MISMATCH
// ============================================================
// ============================================================
// SHORTENED AUTH TAG
// ============================================================

test("shortened auth tag should be rejected by serializer", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,

    auth_tag:
      envelope.auth_tag.slice(
        0,
        envelope.auth_tag.length - 4
      ),
  };

  assert.throws(() => {
    Serializer.pack(modified);
  });
});

// ============================================================
// IV LENGTH MISMATCH
// ============================================================
// ============================================================
// INVALID IV LENGTH
// ============================================================

test("invalid IV length should be rejected by serializer", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,

    aes_gcm_iv:
      envelope.aes_gcm_iv.slice(0, 4),
  };

  assert.throws(() => {
    Serializer.pack(modified);
  });
});

// ============================================================
// EMPTY CIPHERTEXT
// ============================================================

test("empty ciphertext should fail", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    ciphertext: new Uint8Array(0),
  };

  const packed =
    Serializer.pack(modified);

  await assert.rejects(
    async () => {
      await decrypt({
        recipient: bob,
        envelopeBytes: packed,
      });
    }
  );
});

// ============================================================
// RANDOM GARBAGE INPUT
// ============================================================

test("random garbage should fail parsing", async () => {

  const garbage =
    crypto.getRandomValues(
      new Uint8Array(128)
    );

  await assert.rejects(
    async () => {
      await decrypt({
        recipient:
          await PrivateIdentity.generate(),
        envelopeBytes:
          garbage.buffer,
      });
    }
  );
});

// ============================================================
// FIELD SWAP ATTACK
// ============================================================

test("swapping ciphertext and auth_tag should be rejected", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "field swap attack",
    });

  const modified = {
    ...envelope,

    ciphertext:
      envelope.auth_tag,

    auth_tag:
      envelope.ciphertext,
  };

  // ciphertext now only 16 bytes
  // auth_tag now invalid length
  assert.throws(() => {
    Serializer.pack(modified);
  });
});
// ============================================================
// UUID TAMPERING
// ============================================================

test("uuid tampering should not affect decryption", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    uuid: crypto.getRandomValues(
      new Uint8Array(16)
    ),
  };

  const packed =
    Serializer.pack(modified);

  const result =
    await decrypt({
      recipient: bob,
      envelopeBytes: packed,
    });

  // UUID is metadata only
  assert.equal(
    result.plaintext,
    "hello"
  );
});

// ============================================================
// TIMESTAMP TAMPERING
// ============================================================

test("timestamp tampering should not affect decryption", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const envelope =
    await createEncryptedEnvelope({
      sender: alice,
      recipient: new PublicIdentity(
        bob.publicKey
      ),
      plaintext: "hello",
    });

  const modified = {
    ...envelope,
    timestamp: 0n,
  };

  const packed =
    Serializer.pack(modified);

  const result =
    await decrypt({
      recipient: bob,
      envelopeBytes: packed,
    });

  assert.equal(
    result.plaintext,
    "hello"
  );
});