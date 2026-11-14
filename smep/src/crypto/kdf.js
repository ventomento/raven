/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { sha256 } from "./hash.js";

export async function deriveAesKey(sharedSecret) {

  if (!(sharedSecret instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const rawKey = await sha256(sharedSecret);

  return crypto.subtle.importKey(
    "raw",
    rawKey,
    {
      name: "AES-GCM"
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveHmacKey(sharedSecret) {
  
  if (!(sharedSecret instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const rawKey = await sha256(sharedSecret);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"]
  );

  return cryptoKey;

}