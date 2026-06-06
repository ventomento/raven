// src/crypto/hash.js

export async function sha256(data) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return new Uint8Array(digest);
}