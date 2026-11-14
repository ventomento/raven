/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function encodeUtf8(str) {
  
  if (typeof str !== "string") {
    throw new TypeError(
      `Expected string, got ${typeof str}: ${String(str)}`
    );
  }

  const encoder = new TextEncoder();
  return encoder.encode(str);
}

export function decodeUtf8(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}