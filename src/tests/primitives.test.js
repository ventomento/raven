import test from "node:test";
import assert from "node:assert/strict";

import {
  generateKeyPair,
  deriveSharedSecret
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