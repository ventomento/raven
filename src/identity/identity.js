// src/identity/identity.js

import {
  generateKeyPair,
  importPrivateKey,
  exportPrivateKey,
  exportPublicKey
} from "../crypto/x25519.js";

export class Identity {

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

    return new Identity({
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

    const privateKey =
      await importPrivateKey(
        privateKeyHex
      );

    // Derive public key from private key
    // using JWK export trick

    const jwk =
      await crypto.subtle.exportKey(
        "jwk",
        privateKey
      );

    const publicKey =
      await crypto.subtle.importKey(
        "jwk",
        {
          kty: "OKP",
          crv: "X25519",
          x: jwk.x,
          ext: true
        },
        {
          name: "X25519"
        },
        true,
        []
      );

    return new Identity({
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

  // =========================================
  // EXPORT RAW PUBLIC BYTES
  // Envelope usage
  // =========================================

  async exportPublicBytes() {

    const raw =
      await crypto.subtle.exportKey(
        "raw",
        this.publicKey
      );

    return new Uint8Array(raw);
  }

}