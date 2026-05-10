// src/protocol/protocol.js

import {
  importPublicKey,
  exportPublicKeyBytes,
  deriveSharedSecret,
} from "../crypto/x25519.js";

import { deriveAesKey } from "../crypto/kdf.js";

import {
  encryptAesGcm,
  decryptAesGcm,
} from "../crypto/aes-gcm.js";

import { randomIV } from "../crypto/random.js";

import { generateUuidBytes } from "../encoding/uuid.js";
import { encodePlaintext } from "../encoding/plaintext.js";
import { decodeUtf8 } from "../encoding/utf8.js";
import { bytesToHex } from "../encoding/hex.js";

import { Serializer } from "../envelope/serializer.js";
import { ContentTypes } from "../envelope/content-types.js";

import {
  PublicIdentity,
  PrivateIdentity,
} from "../identity/identity.js";

import { require } from "../util/util.js";

// ============================================================
// INTERNAL CRYPTO
// ============================================================

async function encryptBytes({
  senderPrivateKey,
  recipientPublicKey,
  plaintextBytes,
}) {
  const sharedSecret = await deriveSharedSecret(
      senderPrivateKey,
      recipientPublicKey
    );
  const aesKey = await deriveAesKey(sharedSecret);
  const iv = randomIV();

  const { ciphertext, auth_tag } = await encryptAesGcm({
      key: aesKey,
      iv,
      plaintext: plaintextBytes,
    });

  return { iv, ciphertext, auth_tag };
}

async function decryptBytes({
  recipientPrivateKey,
  senderPublicKey,
  envelope,
}) {
  const sharedSecret = await deriveSharedSecret(
      recipientPrivateKey,
      senderPublicKey
    );
  const aesKey = await deriveAesKey(sharedSecret);

  return decryptAesGcm({
    key: aesKey,
    iv: envelope.aes_gcm_iv,
    ciphertext: envelope.ciphertext,
    auth_tag: envelope.auth_tag,
  });
}

// ============================================================
// ENVELOPE LAYER
// ============================================================

export async function createEncryptedEnvelope({
  sender,
  recipient,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8,
}) {
  
  const plaintextBytes = encodePlaintext(plaintext);

  const { iv, ciphertext, auth_tag } = await encryptBytes({
      senderPrivateKey: sender.privateKey,
      recipientPublicKey: recipient.publicKey,
      plaintextBytes,
    });

  return Object.freeze({
    version: Serializer.VERSION,
    uuid: generateUuidBytes(),
    sender_public_key: await exportPublicKeyBytes(sender.publicKey),
    recipient_public_key: await exportPublicKeyBytes(recipient.publicKey),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    content_type: contentType,
    aes_gcm_iv: iv,
    ciphertext,
    auth_tag,
  });
}

export async function decryptEnvelope({
  recipient,
  envelope,
}) {
  require(recipient, PrivateIdentity);

  const senderPublicKey = await importPublicKey(
    envelope.sender_public_key
  );

  let plaintext = await decryptBytes({
    recipientPrivateKey: recipient.privateKey,
    senderPublicKey,
    envelope,
  });

  if (envelope.content_type === ContentTypes.TEXT_UTF8) {
    plaintext = decodeUtf8(plaintext);
  }

  return Object.freeze({
    senderPublicKeyHex: bytesToHex(envelope.sender_public_key),
    recipientPublickeyHex: bytesToHex(envelope.recipient_public_key),
    contentType: envelope.content_type,
    plaintext,
    timestamp: envelope.timestamp,
    uuid: bytesToHex(envelope.uuid),
  });
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

export async function encrypt({
  sender,
  recipient,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8,
}) {
  require(sender, PrivateIdentity);
  require(recipient, PublicIdentity);
  require(plaintext);
  require(contentType);

  const envelope =
    await createEncryptedEnvelope({
      sender,
      recipient,
      plaintext,
      contentType,
    });

  return Serializer.pack(envelope);
}

export async function decrypt({
  recipient,
  encrypted,
}) {
  require(encrypted, ArrayBuffer);

  const envelope = Serializer.unpack(encrypted);

  return decryptEnvelope({
    recipient,
    envelope,
  });
}