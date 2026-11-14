/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function randomBytes(length) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Invalid length");
  }

  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomIV() {
  return randomBytes(12);
}