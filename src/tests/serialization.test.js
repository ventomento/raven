import test from "node:test";
import assert from "node:assert/strict";

import {
  EnvelopePacker
} from "../src/envelope/envelope-packer.js";

// ============================================================
// PACK / UNPACK
// ============================================================

test(
  "Envelope pack/unpack roundtrip",
  () => {

    const envelope = {

      version: 0x01,

      uuid:
        crypto.getRandomValues(
          new Uint8Array(16)
        ),

      sender_public_key:
        crypto.getRandomValues(
          new Uint8Array(32)
        ),

      recipient_public_key:
        crypto.getRandomValues(
          new Uint8Array(32)
        ),

      timestamp: 123456789n,

      content_type: 1,

      payload_size: 0,

      aes_gcm_iv:
        crypto.getRandomValues(
          new Uint8Array(12)
        ),

      ciphertext:
        crypto.getRandomValues(
          new Uint8Array(128)
        ),

      auth_tag:
        crypto.getRandomValues(
          new Uint8Array(16)
        )
    };

    const buffer =
      EnvelopePacker.pack(
        envelope
      );

    const unpacked =
      EnvelopePacker.unpack(
        buffer
      );

    assert.equal(
      unpacked.version,
      1
    );

    assert.equal(
      unpacked.timestamp,
      123456789n
    );

    assert.equal(
      unpacked.content_type,
      1
    );

    assert.equal(
      unpacked.ciphertext.length,
      128
    );

    assert.deepEqual(
      [...unpacked.uuid],
      [...envelope.uuid]
    );
  }
);

// ============================================================
// INVALID VERSION
// ============================================================

test(
  "Envelope rejects invalid version",
  () => {

    const buffer =
      new ArrayBuffer(94);

    const view =
      new Uint8Array(buffer);

    view[0] = 0xff;

    assert.throws(() => {

      EnvelopePacker.unpack(
        buffer
      );

    });
  }
);