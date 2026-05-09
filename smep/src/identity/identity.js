// src/identity/identity.js

import {
  generateKeyPair,
  importPrivateKey,
  exportPrivateKey,
  importPublicKey,
  exportPublicKey,
  derivePublicKeyFromPrivate,
  exportPublicKeyBytes
} from "../crypto/x25519.js";

export class PublicIdentity {

  constructor(publicKey){

    if (!publicKey instanceof CryptoKey){
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
    const publicKey = importPublicKey(publicKeyHex);
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