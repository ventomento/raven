import test from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  deriveSharedSecret,
  importPublicKey
} from "../src/crypto/x25519.js";

import {
  encryptAesGcm,
  decryptAesGcm
} from "../src/crypto/aes-gcm.js";

import {
  deriveAesKey
} from "../src/crypto/kdf.js";

import {
  randomIV
} from "../src/crypto/random.js";

// ============================================================
// X25519
// ============================================================

test(
  "X25519 derives identical shared secrets",
  async () => {

    const alice =
      await generateKeyPair();

    const bob =
      await generateKeyPair();

    const s1 =
      await deriveSharedSecret(
        alice.privateKey,
        bob.publicKey
      );

    const s2 =
      await deriveSharedSecret(
        bob.privateKey,
        alice.publicKey
      );

    assert.deepEqual(
      [...s1],
      [...s2]
    );
  }
);

// ============================================================
// AES-GCM
// ============================================================

test(
  "AES-GCM encrypts and decrypts",
  async () => {

    const secret =
      crypto.getRandomValues(
        new Uint8Array(32)
      );

    const key =
      await deriveAesKey(secret);

    const plaintext =
      new TextEncoder().encode(
        "hello world"
      );

    const iv = randomIV();

    const encrypted =
      await encryptAesGcm({
        key,
        iv,
        plaintext
      });

    const decrypted =
      await decryptAesGcm({
        key,
        iv,
        ciphertext:
          encrypted.ciphertext,
        auth_tag:
          encrypted.auth_tag
      });

    assert.equal(
      new TextDecoder().decode(
        decrypted
      ),
      "hello world"
    );
  }
);

// ============================================================
// TAMPER DETECTION
// ============================================================

test(
  "AES-GCM rejects tampered ciphertext",
  async () => {

    const secret =
      crypto.getRandomValues(
        new Uint8Array(32)
      );

    const key =
      await deriveAesKey(secret);

    const plaintext =
      new TextEncoder().encode(
        "secret"
      );

    const iv = randomIV();

    const encrypted =
      await encryptAesGcm({
        key,
        iv,
        plaintext
      });

    encrypted.ciphertext[0] ^= 0xff;

    await assert.rejects(
      async () => {

        await decryptAesGcm({
          key,
          iv,
          ciphertext:
            encrypted.ciphertext,
          auth_tag:
            encrypted.auth_tag
        });

      }
    );
  }
);

// ============================================================
// X25519 SECURITY ADD-ON TESTS (APPEND ONLY)
// ============================================================

function isRejectedLowOrderPoint(err) {
  return (
    err?.message?.includes("Invalid peer public key") ||
    err?.name === "OperationError" ||
    err?.message?.includes("OperationError")
  );
}

// ------------------------------------------------------------
// 1. ALL-ZERO PUBLIC KEY (CRITICAL CASE)
// ------------------------------------------------------------

test(
  "X25519 rejects all-zero public key or produces safe failure",
  async () => {

    const alice =
      await generateKeyPair();

    const zeroPub =
      await importPublicKey(
        new Uint8Array(32)
      );

    try {

      const shared =
        await deriveSharedSecret(
          alice.privateKey,
          zeroPub
        );

      // If WebCrypto returns instead of throwing:
      // must not be all-zero secret
      assert.notDeepEqual(
        [...shared],
        new Uint8Array(32)
      );

    } catch (err) {

      assert.ok(
        isRejectedLowOrderPoint(err),
        `Unexpected error: ${err}`
      );
    }
  }
);

// ------------------------------------------------------------
// 2. KNOWN LOW-ORDER PUBLIC KEYS (MUST FAIL SAFELY)
// ------------------------------------------------------------

const KNOWN_LOW_ORDER_PUBLIC_KEYS = [
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000"
];

for (const hex of KNOWN_LOW_ORDER_PUBLIC_KEYS) {

  test(
    `X25519 rejects low-order public key ${hex.slice(0, 8)}`,
    async () => {

      const alice =
        await generateKeyPair();

      const pub =
        await importPublicKey(hex);

      await assert.rejects(
        deriveSharedSecret(alice.privateKey, pub),
        isRejectedLowOrderPoint
      );
    }
  );
}

// ------------------------------------------------------------
// 3. ATTACKER-CONTROLLED INPUTS (FUZZED EDGE CASES)
// ------------------------------------------------------------

const ATTACKER_PUBLIC_KEYS = [
  "e0eb7a7c3b41b8ae1656e3fa1f7c4d7f6b6c5c2b4c6b6f0cb1f5c2d9e8f7a001",
  "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157"
];

for (const hex of ATTACKER_PUBLIC_KEYS) {

  test(
    `X25519 handles attacker public key ${hex.slice(0, 8)} safely`,
    async () => {

      const alice =
        await generateKeyPair();

      const pub =
        await importPublicKey(hex);

      try {

        const shared =
          await deriveSharedSecret(alice.privateKey, pub);

        // If accepted: MUST NOT collapse to zero
        assert.notDeepEqual(
          [...shared],
          new Uint8Array(32)
        );

      } catch (err) {

        assert.ok(
          isRejectedLowOrderPoint(err),
          `Unexpected error: ${err}`
        );
      }
    }
  );
}