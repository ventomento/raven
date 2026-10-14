import {
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
import { sha256 } from "../crypto/hash.js";
import { encodeUtf8, decodeUtf8 } from "../encoding/utf8.js";
import { bytesToHex } from "../encoding/hex.js";
import { EnvelopeWriter } from "../envelope/envelope-writer.js";
import { readEnvelope } from "../envelope/envelope-reader.js";
import { ContentTypes } from "../envelope/content-types.js";
import { insist } from "../util/util.js";

async function deriveEnvelopeKey(privateKey, peerPublicKey) {
  const sharedSecret = await deriveSharedSecret(privateKey, peerPublicKey);
  return deriveAesKey(sharedSecret);
}

function encodePlaintext(
  plaintext
) {
  if (typeof plaintext == "string") {
    return encodeUtf8(plaintext);
  }

  if (plaintext instanceof Uint8Array) {
    return plaintext;
  }

  if (plaintext instanceof ArrayBuffer) {
    return new Uint8Array(plaintext);
  }

  throw new Error("Type Error");
}

export async function createEnvelope({
  sender,
  recipient,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8,
}) {

  const plaintextBytes = encodePlaintext(plaintext);

  const writer = new EnvelopeWriter(EnvelopeWriter.size(plaintextBytes.length));

  const header = writer.writeHeader({
    sender_public_key: await exportPublicKeyBytes(sender.publicKey),
    recipient_public_key: await exportPublicKeyBytes(recipient.publicKey),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    content_type: contentType,
  });

  const aes_gcm_iv = randomIV();

  const ciphertext_with_tag = await encryptAesGcm({
    key: await deriveEnvelopeKey(sender.privateKey, recipient.publicKey),
    iv: aes_gcm_iv,
    plaintext: plaintextBytes,
    aad: header,
  });

  writer.writeBody({ aes_gcm_iv, ciphertext_with_tag });

  return writer.finish();
}

export async function envelopeHash(envelopeBytes) {
  const bytes = envelopeBytes instanceof ArrayBuffer
    ? new Uint8Array(envelopeBytes)
    : envelopeBytes;

  return bytesToHex(await sha256(bytes));
}

export async function decryptEnvelope({
  identity,
  envelope,
}) {
  const identityPublicHex = await identity.exportPublicHex();

  const envelopeSenderPublicHex = bytesToHex(envelope.sender_public_key);
  const envelopeRecipientPublicHex = bytesToHex(envelope.recipient_public_key);

  const peerPublicHex =
    (identityPublicHex === envelopeSenderPublicHex)
      ? envelopeRecipientPublicHex
      : envelopeSenderPublicHex;

  const peerPublicKey = (await PublicIdentity.fromPublicHex(peerPublicHex)).publicKey;

  let plaintext = await decryptAesGcm({
    key: await deriveEnvelopeKey(identity.privateKey, peerPublicKey),
    iv: envelope.aes_gcm_iv,
    ciphertextWithTag: envelope.ciphertext_with_tag,
    aad: envelope.header,
  });

  if (envelope.content_type === ContentTypes.TEXT_UTF8) {
    plaintext = decodeUtf8(plaintext);
  }

  return Object.freeze({
    senderPublicKeyHex: envelopeSenderPublicHex,
    recipientPublicKeyHex: envelopeRecipientPublicHex,
    contentType: envelope.content_type,
    plaintext,
    timestamp: Number(envelope.timestamp),
  });
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

  return createEnvelope({
    sender,
    recipient,
    plaintext,
    contentType,
  });
}

export async function decrypt({
  identity,
  envelopeBytes,
}) {
  insist(identity, PrivateIdentity);
  insist(envelopeBytes, ArrayBuffer);

  const envelope = readEnvelope(envelopeBytes);

  return decryptEnvelope({
    identity,
    envelope,
  });
}