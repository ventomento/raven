import {
  generateKeyPair,
  importPrivateKey,
  exportPrivateKey,
  importPublicKey,
  exportPublicKey,
  exportPublicKeyBytes,
} from "../crypto/x25519.js";

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
    publicKey,
    publicKeyHex = null
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
    this.publicKeyHex = publicKeyHex;

    Object.freeze(this);
  }

  static async generate() {

    const pair =
      await generateKeyPair();

    const publicKeyHex = await exportPublicKey(pair.publicKey);

    return new PrivateIdentity({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      publicKeyHex
    });
  }

  static async fromPrivateKeyHex(
    privateKeyHex
  ) {

    if (
      typeof privateKeyHex !== "string"
    ) {
      throw new Error(
        "privateKeyHex must be string"
      );
    }

    const {privateKey, publicKey} = await importPrivateKey(privateKeyHex);

    const publicKeyHex = await exportPublicKey(publicKey);

    return new PrivateIdentity({
      privateKey,
      publicKey,
      publicKeyHex
    });
  }

  async exportPrivateHex() {

    return exportPrivateKey(
      this.privateKey
    );
  }

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
