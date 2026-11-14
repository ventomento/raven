/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

export async function verifyHmacSha256(
  cryptoKey,
  data,
  signature
) {
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