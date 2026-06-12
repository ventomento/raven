// src/crypto/hmac.js

export async function hmacSha256(key, data) {
  if (!(key instanceof Uint8Array)) {
    throw new TypeError("Expected key to be Uint8Array");
  }

  if (!(data instanceof Uint8Array)) {
    throw new TypeError("Expected data to be Uint8Array");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    data
  );

  return new Uint8Array(signature);
}