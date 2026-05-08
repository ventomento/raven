import test from "node:test";
import assert from "node:assert/strict";

import {
  Identity
} from "../src/identity/identity.js";

import {
  encryptMessage,
  decryptMessage
} from "../src/protocol/protocol.js";

// ============================================================
// ENCRYPT / DECRYPT
// ============================================================

test(
  "Protocol encrypts and decrypts UTF8 messages",
  async () => {

    const alice =
      await Identity.generate();

    const bob =
      await Identity.generate();

    const encrypted =
      await encryptMessage({

        sender: alice,

        recipientPublicKeyHex:
          await bob.exportPublicHex(),

        plaintext:
          "hello bob"
      });

    const decrypted =
      await decryptMessage({

        recipient: bob,

        envelopeBuffer:
          encrypted.buffer
      });

    assert.equal(
      decrypted.data,
      "hello bob"
    );
  }
);

// ============================================================
// IDENTITY RESTORE
// ============================================================

test(
  "Identity restores from private hex",
  async () => {

    const identity =
      await Identity.generate();

    const privateHex =
      await identity.exportPrivateHex();

    const restored =
      await Identity.fromPrivateHex(
        privateHex
      );

    assert.equal(

      await restored.exportPublicHex(),

      await identity.exportPublicHex()
    );
  }
);

// ============================================================
// TAMPER DETECTION
// ============================================================

test(
  "Protocol rejects tampered messages",
  async () => {

    const alice =
      await Identity.generate();

    const bob =
      await Identity.generate();

    const encrypted =
      await encryptMessage({

        sender: alice,

        recipientPublicKeyHex:
          await bob.exportPublicHex(),

        plaintext:
          "super secret"
      });

    const tampered =
      encrypted.buffer.slice(0);

    const view =
      new Uint8Array(tampered);

    // flip one bit in ciphertext area
    view[120] ^= 0xff;

    await assert.rejects(
      async () => {

        await decryptMessage({

          recipient: bob,

          envelopeBuffer:
            tampered
        });

      }
    );
  }
);