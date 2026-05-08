// src/protocol/protocol.js

import {
  importPublicKey,
  deriveSharedSecret
} from "../crypto/x25519.js";

import {
  deriveAesKey
} from "../crypto/kdf.js";

import {
  encryptAesGcm,
  decryptAesGcm
} from "../crypto/aes-gcm.js";

import {
  randomIV
} from "../crypto/random.js";

import {
  generateUuidBytes
} from "../encoding/uuid.js";

import {
  encodeUtf8,
  decodeUtf8
} from "../encoding/utf8.js";

import {
  bytesToHex
} from "../encoding/hex.js";

import {
  EnvelopePacker
} from "../envelope/envelope-packer.js";

import {
  ContentTypes
} from "../envelope/envelope-types.js";

// ============================================================
// ENCRYPT MESSAGE
// ============================================================

export async function encryptMessage({

  sender,
  // is an identity

  recipientPublicKeyHex,

  plaintext,

  contentType = ContentTypes.TEXT_UTF8

}) {

  // ==========================================================
  // VALIDATION
  // ==========================================================

  if (!sender) {
    throw new Error("Missing sender");
  }

  if (
    typeof recipientPublicKeyHex !==
    "string"
  ) {
    throw new Error(
      "recipientPublicKeyHex required"
    );
  }

  // ==========================================================
  // IMPORT RECIPIENT PUBLIC KEY
  // ==========================================================

  const recipientPublicKey =
    await importPublicKey(
      recipientPublicKeyHex
    );

  // ==========================================================
  // DERIVE SHARED SECRET
  // ==========================================================

  const sharedSecret =
    await deriveSharedSecret(
      sender.privateKey,
      recipientPublicKey
    );

  // ==========================================================
  // DERIVE AES KEY
  // ==========================================================

  const aesKey =
    await deriveAesKey(
      sharedSecret
    );

  // ==========================================================
  // ENCODE PLAINTEXT
  // ==========================================================

  let plaintextBytes;

  if (typeof plaintext === "string") {

    plaintextBytes =
      encodeUtf8(plaintext);

  } else if (
    plaintext instanceof Uint8Array
  ) {

    plaintextBytes = plaintext;

  } else {

    throw new Error(
      "plaintext must be string or Uint8Array"
    );
  }

  // ==========================================================
  // ENCRYPT
  // ==========================================================

  const iv = randomIV();

  const {ciphertext, auth_tag } = await encryptAesGcm({
    key: aesKey,
    iv,
    plaintext: plaintextBytes
  });

  // ==========================================================
  // EXPORT PUBLIC KEYS
  // ==========================================================

  const sender_public_key =
    await sender.exportPublicBytes();

  const recipient_public_key =
    new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        recipientPublicKey
      )
    );

  // ==========================================================
  // BUILD ENVELOPE
  // ==========================================================

  const envelope = {

    version: 0x01,

    uuid: generateUuidBytes(),

    sender_public_key,

    recipient_public_key,

    timestamp:
      BigInt(
        Math.floor(Date.now() / 1000)
      ),

    content_type: contentType,

    payload_size:
      12 +
      ciphertext.length +
      16,

    aes_gcm_iv: iv,

    ciphertext,

    auth_tag
  };

  // ==========================================================
  // SERIALIZE
  // ==========================================================

  const buffer =
    EnvelopePacker.pack(envelope);

  return Object.freeze({

    envelope,

    buffer

  });
}

// ============================================================
// DECRYPT MESSAGE
// ============================================================

export async function decryptMessage({

  recipient,
  //identity

  envelopeBuffer

}) {

  // ==========================================================
  // VALIDATION
  // ==========================================================

  if (!recipient) {
    throw new Error(
      "Missing recipient"
    );
  }

  if (
    !(envelopeBuffer instanceof ArrayBuffer)
  ) {
    throw new Error(
      "envelopeBuffer must be ArrayBuffer"
    );
  }

  // ==========================================================
  // UNPACK ENVELOPE
  // ==========================================================

  const envelope =
    EnvelopePacker.unpack(
      envelopeBuffer
    );

  // ==========================================================
  // IMPORT SENDER PUBLIC KEY
  // ==========================================================

  const senderPublicKey =
    await importPublicKey(
      bytesToHex(
        envelope.sender_public_key
      )
    );

  // ==========================================================
  // DERIVE SHARED SECRET
  // ==========================================================

  const sharedSecret =
    await deriveSharedSecret(

      recipient.privateKey,

      senderPublicKey
    );

  // ==========================================================
  // DERIVE AES KEY
  // ==========================================================

  const aesKey =
    await deriveAesKey(
      sharedSecret
    );

  // ==========================================================
  // DECRYPT
  // ==========================================================

  const plaintext =
    await decryptAesGcm({

      key: aesKey,

      iv: envelope.aes_gcm_iv,

      ciphertext:
        envelope.ciphertext,

      auth_tag:
        envelope.auth_tag
    });

  // ==========================================================
  // AUTO-DECODE UTF8
  // ==========================================================

  let data = plaintext;

  if (
    envelope.content_type ===
    ContentTypes.TEXT_UTF8
  ) {

    data = decodeUtf8(
      plaintext
    );
  }

  return Object.freeze({

    envelope,

    plaintext,

    data

  });
}