// src/protocol/protocol.js

import { importPublicKey, deriveSharedSecret, exportPublicKeyBytes  } from "../crypto/x25519.js";
import { deriveAesKey } from "../crypto/kdf.js";
import { encryptAesGcm, decryptAesGcm } from "../crypto/aes-gcm.js";
import { randomIV } from "../crypto/random.js";
import { generateUuidBytes } from "../encoding/uuid.js";
import { encodePlaintext, decodePlaintext } from "../encoding/plaintext.js";
import { bytesToHex } from "../encoding/hex.js";
import { Serializer } from "../envelope/serializer.js";
import {ContentTypes} from "../envelope/content-types.js";
import { Identity } from "../identity/identity.js";

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
  sender, // Identity: holds imported identity. That is private and public key pair.
  recipientPublicKeyHex,
  plaintext,
  contentType = ContentTypes.TEXT_UTF8}){

  require(senderPrivateKey, Identity);
  require(recipientPublicKeyHex, "string");
  require(plaintext);
  require(contentType);

  const recipientPublicKey = await importPublicKey(recipientPublicKeyHex);
  
  plaintextBytes = encodePlaintext(plaintext);

  const {iv, ciphertext, auth_tag} = 
    await _encrypt({
      privateKey : senderPrivateKey,
      publicKey : recipientPublicKey,
      bytes : plaintextBytes 
      })

  // ==========================================================
  // BUILD ENVELOPE
  // ==========================================================
  const envelope = {
    version: 0x01,
    uuid: generateUuidBytes(),
    sender_public_key: await exportPublicKeyBytes(sender.publicKey),
    recipient_public_key: await exportPublicKeyBytes(recipientPublicKey),
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
  return Serializer.pack(envelope);
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
      ciphertext: envelope.ciphertext,
      auth_tag: envelope.auth_tag
    });

  return plaintext;
}

export async function decryptEnvelopeBytes({
  recipient,
  envelopeBuffer
}) {

  require(recipient, Identity);
  require(envelopeBuffer, ArrayBuffer);

  const envelope = await Serializer.unpack(
      envelopeBuffer
    );

  let plaintext = _decrypt({
    privateKey: recipient.privateKey,
    publicKey: await importPublicKey(envelope.sender_public_key),
    envelope: envelope
  })
  plaintext = decodePlaintext(plaintext);  

  return Object.freeze({
    senderPublicKeyHex: bytesToHex(envelope.sender_public_key),
    contentType: envelope.content_type,
    plaintext,
  });
}