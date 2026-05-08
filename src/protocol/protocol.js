// src/protocol/protocol.js

import { importPublicKey, deriveSharedSecret, exportPublicKeyBytes } from "../crypto/x25519.js";
import { deriveAesKey } from "../crypto/kdf.js";
import { encryptAesGcm, decryptAesGcm } from "../crypto/aes-gcm.js";
import { randomIV } from "../crypto/random.js";
import { generateUuidBytes } from "../encoding/uuid.js";
import { encodePlaintext, decodePlaintext } from "../encoding/plaintext.js";
import { bytesToHex } from "../encoding/hex.js";
import { Serializer } from "../envelope/serializer.js";
import {ContentTypes} from "../envelope/content-types.js";

async function _encrypt({privateKey, publicKey, bytes}){

  const sharedSecret =
    await deriveSharedSecret(
      privateKey,
      publicKey
    );
 
  const aesKey =
    await deriveAesKey(
      sharedSecret
    );

  const iv = randomIV();

  const {ciphertext, auth_tag } = await encryptAesGcm({
    key: aesKey,
    iv,
    plaintext: bytes
  });

  return {iv, ciphertext, auth_tag};
}


export async function encryptMessage({
  sender, // is an identity
  recipientPublicKeyHex,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8}){

  require(sender);
  require(recipientPublicKey, "string");
  require(plaintext);
  require(contentType);

  const recipientPublicKey = await importPublicKey(
      recipientPublicKeyHex
    );
  
  plaintextBytes = encodePlaintext(plaintext);

  const {iv, ciphertext, auth_tag} = 
    await _encrypt({
      privateKey : sender.privateKey,
      publicKey : recipientPublicKey,
      bytes : plaintextBytes 
      })

  // ==========================================================
  // EXPORT PUBLIC KEYS
  // ==========================================================

  const sender_public_key =
    await exportPublicKeyBytes(sender.publicKey);

  const recipient_public_key = 
    await exportPublicKeyBytes(recipientPublicKey);

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
    Serializer.pack(envelope);

  return buffer
}

async function _decrypt({privateKey, publicKey, envelope}){
  
  const sharedSecret =
    await deriveSharedSecret(
      privateKey,
      publicKey
    );

  const aesKey =
    await deriveAesKey(
      sharedSecret
    );

  const plaintext =
    await decryptAesGcm({
      key: aesKey,
      iv: envelope.aes_gcm_iv,
      ciphertext:
        envelope.ciphertext,
      auth_tag:
        envelope.auth_tag
    });

  return plaintext;
}

export async function decryptEvelopeBuffer({
  recipient,
  envelopeBuffer
}) {

  require(recipient);
  require(envelopeBuffer, ArrayBuffer)

  const envelope = await Serializer.unpack(
      envelopeBuffer
    );

  const senderPublicKeyHex =
    bytesToHex(envelope.sender_public_key);

  const senderPublicKey =
    await importPublicKey(envelope.sender_public_key);

  const plaintext = _decrypt({
    privateKey: recipient.privateKey,
    publicKey: senderPublicKey,
    envelope: envelope
  })

  plaintext = decodePlaintext(plaintext);  

  return Object.freeze({
    senderPublicKeyHex,
    contentType: envelope.content_type,
    plaintext,
  });
}