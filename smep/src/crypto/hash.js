/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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