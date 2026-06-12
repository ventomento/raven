// src/protocol/protocol.js

import {
  generateKeyPair,
  importPrivateKey,
  exportPrivateKey,
  importPublicKey,
  exportPublicKey,
  exportPublicKeyBytes,
  deriveSharedSecret,
} from "../crypto/x25519.js";

import { PrivateIdentity, PublicIdentity } from "../identity/identity.js";

import { deriveAesKey } from "../crypto/kdf.js";

import {
  encryptAesGcm,
  decryptAesGcm,
} from "../crypto/aes-gcm.js";

import { randomIV } from "../crypto/random.js";
import { generateUuidBytes } from "../encoding/uuid.js";
import { encodeUtf8, decodeUtf8 } from "../encoding/utf8.js";
import { bytesToHex } from "../encoding/hex.js";
import { Serializer } from "../envelope/serializer.js";
import { ContentTypes } from "../envelope/content-types.js";
import { insist } from "../util/util.js";
import { sha256 } from "../crypto/hash.js";
import { hmacSha256 } from "../crypto/hmac.js";

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

function encodePlaintext(
  plaintext
) {

  // plaintext protocol data abstraction. = bytes or string.

  if (typeof plaintext == "string") {
    return encodeUtf8(plaintext);
  }

  if (
    (plaintext instanceof Uint8Array) ||
    (plaintext instanceof ArrayBuffer)
  ) {
    return plaintext;
  }

  throw new Error("Type Error");
}

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
  identity,
  envelope,
}) {

  // Note: attempt to decrypt envelope if identity can, that is, is either sender or recipient.
  // Meaning that this will decrypt both inbound and outgoing messages.

  const identityPublicHex = await identity.exportPublicHex();

  const envelopeSenderPublicHex = bytesToHex(envelope.sender_public_key);
  const envelopeRecipientPublicHex = bytesToHex(envelope.recipient_public_key);

  let senderPublicKey;

  if (identityPublicHex === envelopeSenderPublicHex){
    // special case. Identity is sender, hence swap sender with recipient. As if recipient was sender.
    senderPublicKey = (await PublicIdentity.fromPublicHex(envelopeRecipientPublicHex)).publicKey;
  } else {
    senderPublicKey = (await PublicIdentity.fromPublicHex(envelopeSenderPublicHex)).publicKey;
  }

  let plaintext = await decryptBytes({
    recipientPrivateKey: identity.privateKey,
    senderPublicKey,
    envelope,
  });

  if (envelope.content_type === ContentTypes.TEXT_UTF8) {
    plaintext = decodeUtf8(plaintext);
  }

  return Object.freeze({
    senderPublicKeyHex: bytesToHex(envelope.sender_public_key),
    recipientPublicKeyHex: bytesToHex(envelope.recipient_public_key),
    contentType: envelope.content_type,
    plaintext,
    timestamp: Number(envelope.timestamp),
    uuid: bytesToHex(envelope.uuid),
  });
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

export async function authSign(
  symKey
){
  insist(symKey, Uint8Array);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const timestampEncoded = encodeUtf8(timestamp);

  const signature = await hmacSha256(symKey, timestampEncoded);

  return {
    signature,
    timestamp
  }
}

export async function authSessionKey({
  identity,
  ephemeralPublicKeyHex,
}) {

  insist(identity, PrivateIdentity);
  insist(ephemeralPublicKeyHex, "string");

  const ephemeralPublicKey = await importPublicKey(ephemeralPublicKeyHex);

  const sharedSecret = await deriveSharedSecret(
    identity.privateKey,
    ephemeralPublicKey
  );

  return await sha256(sharedSecret);
}

export async function encrypt({
  sender,
  recipient,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8,
}) {
  insist(sender, PrivateIdentity);
  insist(recipient, PublicIdentity);
  insist(plaintext);
  insist(contentType);

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
  identity,
  envelopeBytes,
}) {
  insist(identity, PrivateIdentity);
  insist(envelopeBytes, ArrayBuffer);

  const envelope = Serializer.unpack(envelopeBytes);

  return decryptEnvelope({
    identity,
    envelope,
  });
}