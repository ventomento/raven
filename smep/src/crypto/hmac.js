// src/crypto/hmac.js

export async function hmacSha256(cryptoKey, data) {

  // cryptoKey: sym hmac key.

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

export async function verifyHmacSha256(
  cryptoKey,
  data,
  signature
) {

  // return: bool

  if (!(cryptoKey instanceof CryptoKey)) {
    throw new TypeError("Expected web crypto key");
  }

  if (!(data instanceof Uint8Array)) {
    throw new TypeError("Expected data to be Uint8Array");
  }

  if (!(signature instanceof Uint8Array)) {
    throw new TypeError("Expected signature to be Uint8Array");
  }

  return await crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signature,
    data
  );
}