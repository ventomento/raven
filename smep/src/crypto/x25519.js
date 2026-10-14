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

  if (typeof publicKeyRaw === "string") {
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
  const raw = await crypto.subtle.exportKey(
    "raw",
    publicKey
  );

  return bytesToHex(new Uint8Array(raw));
}

export async function exportPublicKeyBytes(publicKey) {
  if (!(publicKey instanceof CryptoKey)) {
    throw new TypeError("publicKey must be a CryptoKey");
  }

  if (publicKey.type !== "public") {
    throw new TypeError("CryptoKey must be a public key");
  }

  const raw = await crypto.subtle.exportKey("raw", publicKey);

  return new Uint8Array(raw);
}

export function isClampedX25519Scalar(scalar) {

  if (! (scalar instanceof Uint8Array)){
    console.error("Type Error: isClampedX25519Scalar");
    return false;
  }

  if (scalar.length !== 32) {
    console.error("isclampedX25519: invalid key length");
    return false;
  }

  return (
    (scalar[0] & 0x07) === 0 &&
    (scalar[31] & 0x80) === 0 &&
    (scalar[31] & 0x40) === 0x40
  );
}

export function clampX25519Scalar(bytes) {

  if (! (bytes instanceof Uint8Array)) throw new Error("clampX25519: type error.");

  if (bytes.length !== 32) throw new Error("X25519 scalar must be 32 bytes");

  bytes[0]  &= 0xF8;
  bytes[31] &= 0x7F;
  bytes[31] |= 0x40;
  return bytes;
}

export async function importPrivateKey(scalarHex) {
  let clampedScalar = hexToBytes(scalarHex);

  if ( !(clampedScalar.length === 32)) {
    throw new Error("Invalid X25519 private scalar must be exactly 32 bytes (64 hex characters) and clamped");
  }

  clampedScalar = clampX25519Scalar(clampedScalar);

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
    true,
    ["deriveKey", "deriveBits"]
  );

  let privateJWKFull;
  try {
    privateJWKFull = await crypto.subtle.exportKey("jwk", privateKey);
  } catch (err) {
    throw new Error("Crypto: Outdated browser - export private jwk not supported on browser. Upgrade to latest browser version"); 
    alert("Crypto: Outdated browser - export private jwk not supported on browser. Upgrade to latest browser version"); 
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
