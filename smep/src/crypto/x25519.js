// src/crypto/x25519.js

import { hexToBytes, bytesToHex } from "../encoding/hex.js";


export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: "X25519"
    },
    true,
    ["deriveBits"]
  );
}

export async function importPublicKey(publicKeyRaw) {
  let raw = publicKeyRaw;

  if (typeof publicKeyRaw === "string") { //hex string
    raw = hexToBytes(publicKeyRaw);
  }

  if (raw.length !== 32) {
    throw new Error("Public key must be 32 bytes");
  }

  return await crypto.subtle.importKey(
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
  // returns hex representation

  const raw = await crypto.subtle.exportKey(
    "raw",
    publicKey
  );

  return bytesToHex(new Uint8Array(raw));
}

/**
 * Export an X25519 public key as raw 32-byte Uint8Array.
 *
 * The returned bytes are the standard X25519 public key encoding
 * defined by RFC 7748 ("raw" format).
 *
 * @param {CryptoKey} publicKey - A WebCrypto X25519 public key
 * @returns {Promise<Uint8Array>}
 */
export async function exportPublicKeyBytes(publicKey) {
  if (!(publicKey instanceof CryptoKey)) {
    throw new TypeError("publicKey must be a CryptoKey");
  }

  if (publicKey.type !== "public") {
    throw new TypeError("CryptoKey must be a public key");
  }

  // Export in RFC 7748 raw format (32 bytes)
  const raw = await crypto.subtle.exportKey("raw", publicKey);

  return new Uint8Array(raw);
}

/**
 * Imports a clamped X25519 scalar (as hex) into Web Crypto
 * and returns both the private key and its corresponding public key.
 */
export async function importPrivateKey(scalarHex) {
  // Convert hex string to Uint8Array
  const clampedScalar = hexToBytes(scalarHex);

  if (clampedScalar.length !== 32) {
    throw new Error("X25519 private scalar must be exactly 32 bytes (64 hex characters)");
  }

  // 1. Build PKCS#8
  const pkcs8Header = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
    0x04, 0x22, 0x04, 0x20
  ]);

  const pkcs8 = new Uint8Array(pkcs8Header.length + 32);
  pkcs8.set(pkcs8Header);
  pkcs8.set(clampedScalar, pkcs8Header.length);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "X25519" },
    true,                                 // extractable = true
    ["deriveKey", "deriveBits"]
  );

  // === Try to export as JWK ===
  let privateJWKFull;
  try {
    privateJWKFull = await crypto.subtle.exportKey("jwk", privateKey);
  } catch (err) {
    throw new Error("Crypto: Outdated browser - export private jwk not supported on browser. Upgrade to latest browser version"); 
  }
  
  const publicJWK = { ...privateJWKFull };
  delete publicJWK.d;
  delete publicJWK.key_ops;

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJWK,
    { name: "X25519" },
    true,
    []
  );

  return {
    privateKey,
    publicKey
  };
}

export async function exportPrivateKey(privateKey) {
  // exports hex of private scalar (clamped seed).

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey(
      "pkcs8",
      privateKey
    )
  );

  const clampedScalar = pkcs8.slice(-32);

  return bytesToHex(clampedScalar);
}

function isAllZero(bytes) {
  let acc = 0;

  for (const b of bytes) {
    acc |= b;
  }

  if (acc === 0) {
    throw new Error("Invalid peer public key");
  }
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

  const shared = new Uint8Array(bits);
  isAllZero(shared);

  return shared;
}


/* Notes:
X25519 public keys are intentionally not fully validated at import time. 
The design of Curve25519/X25519 allows arbitrary 32-byte inputs, including non-canonical encodings and twist points, 
to simplify implementations and avoid many historical ECC validation bugs.

Security against malicious public keys is instead enforced during shared-secret derivation. 
X25519 private scalars are clamped to be multiples of 8, so multiplying by any low-order point (order 1, 2, 4, or 8) collapses
 to the identity element. In X25519, the identity encodes as 32 zero bytes. Therefore, any dangerous small-subgroup input 
 produces an all-zero shared secret.

The correct defense is thus:

perform X25519 normally,
reject the result if the derived shared secret is all zeros.

This is the standard mitigation described in RFC 7748 and protects against low-order/small-subgroup attacks without 
requiring expensive curve-point validation.
*/