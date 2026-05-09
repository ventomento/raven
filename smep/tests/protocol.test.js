// test/protocol.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  createEncryptedEnvelope,
  decryptEnvelope,
} from "../src/protocol/protocol.js";

import { randomBytes } from "node:crypto";

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

// ============================================================
// EVIL SENDER / MALICIOUS ENVELOPE TESTS
// ============================================================

// ============================================================
// LOW-ORDER / INVALID X25519 PUBLIC KEYS
// ============================================================

test("rejects all-zero sender public key", async () => {
  const recipient =
    await PrivateIdentity.generate();

  const sender =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "malicious sender key",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    sender_public_key:
      new Uint8Array(32),
  };

  await assert.rejects(async () => {
    await decryptEnvelope({
      recipient,
      envelope: tampered,
    });
  });
});

test("rejects known low-order X25519 point", async () => {
  const recipient =
    await PrivateIdentity.generate();

  const sender =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "low order attack",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const lowOrder =
    Uint8Array.from([
      1, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);

  const tampered = {
    ...envelope,
    sender_public_key:
      lowOrder,
  };

  await assert.rejects(async () => {
    await decryptEnvelope({
      recipient,
      envelope: tampered,
    });
  });
});

// ============================================================
// SERIALIZER NORMALIZES payload_size
// ============================================================

test("Serializer recomputes forged payload_size", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "payload normalization",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    payload_size: 1,
  };

  const repacked =
    Serializer.pack(tampered);

  const unpacked =
    Serializer.unpack(repacked);

  const expected =
    Serializer.SIZES.NONCE +
    unpacked.ciphertext.length +
    Serializer.SIZES.TAG;

  assert.equal(
    unpacked.payload_size,
    expected
  );
});

test("Serializer ignores oversized forged payload_size", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "oversized payload size",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    payload_size:
      0xffffffff,
  };

  const repacked =
    Serializer.pack(tampered);

  const unpacked =
    Serializer.unpack(repacked);

  const expected =
    Serializer.SIZES.NONCE +
    unpacked.ciphertext.length +
    Serializer.SIZES.TAG;

  assert.equal(
    unpacked.payload_size,
    expected
  );
});

// ============================================================
// MALFORMED WIRE PAYLOAD LENGTHS
// ============================================================

test("rejects wire payload_size smaller than actual", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "wire size attack",
    });

  const bytes =
    new Uint8Array(encrypted);

  // payload_size offset:
  // 1 + 16 + 32 + 32 + 8 + 1 = 90
  const payloadSizeOffset = 90;

  const view =
    new DataView(bytes.buffer);

  view.setUint32(
    payloadSizeOffset,
    1,
    false
  );

  await assert.rejects(async () => {
    Serializer.unpack(bytes.buffer);
  });
});

test("rejects wire payload_size larger than actual", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "wire size attack",
    });

  const bytes =
    new Uint8Array(encrypted);

  const payloadSizeOffset = 90;

  const view =
    new DataView(bytes.buffer);

  view.setUint32(
    payloadSizeOffset,
    0xffffffff,
    false
  );

  await assert.rejects(async () => {
    Serializer.unpack(bytes.buffer);
  });
});

// ============================================================
// RECIPIENT TAMPERING
// ============================================================

test("tampering recipient_public_key does not affect integrity", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const attacker =
    await PrivateIdentity.generate();

  const plaintext =
    "recipient tamper";

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext,
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    recipient_public_key: await attacker.exportPublicBytes(),
  };

  const repacked =
    Serializer.pack(tampered);

  const result =
    await decrypt({
      recipient,
      encrypted: repacked,
    });

  assert.equal(
    result.plaintext,
    plaintext
  );
});
// ============================================================
// AES-GCM AUTHENTICATION TAMPERING
// ============================================================

test("tampering IV causes authentication failure", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "iv tamper",
    });

  const bytes =
    new Uint8Array(encrypted);

  const ivOffset = 94;

  bytes[ivOffset] ^= 0xff;

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted,
    });
  });
});

test("tampering ciphertext causes authentication failure", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "ciphertext tamper",
    });

  const bytes =
    new Uint8Array(encrypted);

  const ciphertextOffset =
    94 + 12;

  bytes[ciphertextOffset] ^= 0xff;

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted,
    });
  });
});

test("tampering auth tag causes authentication failure", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "tag tamper",
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
// VERSION CONFUSION
// ============================================================

test("rejects unsupported protocol version", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "bad version",
    });

  const bytes =
    new Uint8Array(encrypted);

  bytes[0] = 0xff;

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted,
    });
  });
});

// ============================================================
// RANDOM GARBAGE INPUT
// ============================================================

test("rejects random garbage input", async () => {
  const recipient =
    await PrivateIdentity.generate();

  const garbage =
    randomBytes(512);

  await assert.rejects(async () => {
    await decrypt({
      recipient,
      encrypted:
        garbage.buffer,
    });
  });
});

// ============================================================
// INVALID FIELD LENGTHS
// ============================================================

test("rejects malformed sender public key length", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "bad sender key length",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    sender_public_key:
      new Uint8Array(31),
  };

  await assert.rejects(async () => {
    await decryptEnvelope({
      recipient,
      envelope: tampered,
    });
  });
});

test("rejects malformed recipient public key length", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "bad recipient key length",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    recipient_public_key:
      new Uint8Array(31),
  };

  assert.throws(() => {
    Serializer.pack(tampered);
  });
});

test("rejects malformed UUID length", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "bad uuid",
    });

  const envelope =
    Serializer.unpack(encrypted);

  const tampered = {
    ...envelope,
    uuid:
      new Uint8Array(15),
  };

  assert.throws(() => {
    Serializer.pack(tampered);
  });
});

// ============================================================
// TRUNCATION TESTS
// ============================================================

test("rejects truncation at multiple offsets", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext:
        "truncate fuzz",
    });

  for (
    let i = 1;
    i < 32;
    i++
  ) {
    const truncated =
      encrypted.slice(
        0,
        encrypted.byteLength - i
      );

    await assert.rejects(
      async () => {
        await decrypt({
          recipient,
          encrypted:
            truncated,
        });
      }
    );
  }
});

// ============================================================
// HEADER PROBLEMS
// ============================================================
test("header corruption never compromises integrity", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const plaintext =
    "header fuzz";

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext,
    });

  for (
    let i = 0;
    i < Serializer.HEADER_SIZE;
    i++
  ) {
    const mutated =
      encrypted.slice(0);

    const bytes =
      new Uint8Array(mutated);

    bytes[i] ^= 0xff;

    try {
      const result =
        await decrypt({
          recipient,
          encrypted: mutated,
        });

      // If decrypt succeeds,
      // plaintext integrity must hold.

      assert.equal(
        result.plaintext,
        plaintext
      );

    } catch (err) {
      // rejection is also acceptable
      assert.ok(err instanceof Error);
    }
  }
});

test("header corruption either rejects or changes semantics safely", async () => {
  const sender =
    await PrivateIdentity.generate();

  const recipient =
    await PrivateIdentity.generate();

  const plaintext =
    "header fuzz";

  const encrypted =
    await encrypt({
      sender,
      recipient:
        new PublicIdentity(
          recipient.publicKey
        ),
      plaintext,
    });

  for (
    let i = 0;
    i < Serializer.HEADER_SIZE;
    i++
  ) {
    const mutated =
      encrypted.slice(0);

    const bytes =
      new Uint8Array(mutated);

    bytes[i] ^= 0xff;

    try {
      const result =
        await decrypt({
          recipient,
          encrypted: mutated,
        });

      // If decrypt succeeds,
      // plaintext must still be intact.

      assert.equal(
        result.plaintext,
        plaintext
      );

    } catch (err) {
      // rejection is acceptable
      assert.ok(err instanceof Error);
    }
  }
});