// src/protocol/protocol.js

import {
  generateKeyPair,
  importPrivateKey,
  exportPrivateKey,
  importPublicKey,
  exportPublicKey,
  derivePublicKeyFromPrivate,
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
    recipientPublicKeyHex: bytesToHex(envelope.recipient_public_key),
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
  envelopeBytes,
}) {
  require(envelopeBytes, ArrayBuffer);

  const envelope = Serializer.unpack(envelopeBytes);

  return decryptEnvelope({
    recipient,
    envelope,
  });
}

// identity

export class PublicIdentity {

  constructor(publicKey){

    if (! (publicKey instanceof CryptoKey) ){
      throw new Error("publicKey must be cryptokey");
    }
    
    if (publicKey.type !== "public") {
      throw new Error(
        "publicKey must be public"
      );
    }
    
    this.publicKey = publicKey;
    Object.freeze(this);
  }

  static async fromPublicHex(publicKeyHex){
    const publicKey = await importPublicKey(publicKeyHex);
    return new PublicIdentity(publicKey);
  }
}

export class PrivateIdentity {

  constructor({
    privateKey,
    publicKey
  }) {

    if (!(privateKey instanceof CryptoKey)) {
      throw new Error(
        "privateKey must be CryptoKey"
      );
    }

    if (!(publicKey instanceof CryptoKey)) {
      throw new Error(
        "publicKey must be CryptoKey"
      );
    }

    if (privateKey.type !== "private") {
      throw new Error(
        "privateKey must be private"
      );
    }

    if (publicKey.type !== "public") {
      throw new Error(
        "publicKey must be public"
      );
    }

    this.privateKey = privateKey;
    this.publicKey = publicKey;

    Object.freeze(this);
  }

  // =========================================
  // GENERATE NEW IDENTITY
  // =========================================

  static async generate() {

    const pair =
      await generateKeyPair();

    return new PrivateIdentity({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey
    });
  }

  // =========================================
  // LOAD IDENTITY FROM PRIVATE HEX
  // =========================================

  static async fromPrivateHex(
    privateKeyHex
  ) {

    if (
      typeof privateKeyHex !== "string"
    ) {
      throw new Error(
        "privateKeyHex must be string"
      );
    }

    const privateKey = await importPrivateKey(privateKeyHex);
    const publicKey = await derivePublicKeyFromPrivate(privateKey);

    return new PrivateIdentity({
      privateKey,
      publicKey
    });
  }

  // =========================================
  // EXPORT PRIVATE SEED HEX
  // =========================================

  async exportPrivateHex() {

    return exportPrivateKey(
      this.privateKey
    );
  }

  // =========================================
  // EXPORT PUBLIC ADDRESS HEX
  // =========================================

  async exportPublicHex() {

    return exportPublicKey(
      this.publicKey
    );
  }

  async exportPublicBytes(){
    return exportPublicKeyBytes(
      this.publicKey
    );
  }

}
