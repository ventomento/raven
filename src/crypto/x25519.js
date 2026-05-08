// src/crypto/x25519.js

import { hexToBytes, bytesToHex } from "../encoding/hex.js";

const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e,
  0x02, 0x01, 0x00,
  0x30, 0x05,
  0x06, 0x03, 0x2b, 0x65, 0x6e,
  0x04, 0x22,
  0x04, 0x20
]);

export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: "X25519"
    },
    true,
    ["deriveBits"]
  );
}

export async function importPublicKey(publicKeyHex) {

  const raw = hexToBytes(publicKeyHex);

  if (raw.length !== 32) {
    throw new Error("Public key must be 32 bytes");
  }

  return crypto.subtle.importKey(
    "raw",
    raw,
    {
      name: "X25519"
    },
    true,
    []
  );
}

export async function exportPublicKey(publicKey) {

  const raw = await crypto.subtle.exportKey(
    "raw",
    publicKey
  );

  return bytesToHex(new Uint8Array(raw));
}

export async function importPrivateKey(privateSeedHex) {

  const seed = hexToBytes(privateSeedHex);

  if (seed.length !== 32) {
    throw new Error("Private seed must be 32 bytes");
  }

  const pkcs8 = new Uint8Array(
    PKCS8_PREFIX.length + seed.length
  );

  pkcs8.set(PKCS8_PREFIX, 0);
  pkcs8.set(seed, PKCS8_PREFIX.length);

  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    {
      name: "X25519"
    },
    true,
    ["deriveBits"]
  );
}

export async function exportPrivateKey(privateKey) {

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey(
      "pkcs8",
      privateKey
    )
  );

  const seed = pkcs8.slice(-32);

  return bytesToHex(seed);
}

export async function deriveSharedSecret(
  privateKey,
  publicKey
) {

  const bits = await crypto.subtle.deriveBits(
    {
      name: "X25519",
      public: publicKey
    },
    privateKey,
    256
  );

  return new Uint8Array(bits);
}