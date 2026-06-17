// src/crypto/hmac.js

export async function hmacSha256(cryptoKey, data) {

  if(! (cryptoKey instanceof CryptoKey)) {
    throw new TypeError("Expected web crypto key");
  }

  if (!(data instanceof Uint8Array)) {
    throw new TypeError("Expected data to be Uint8Array");
  }

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    data
  );

  return new Uint8Array(signature);
}