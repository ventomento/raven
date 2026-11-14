/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const EnvelopeLayout = Object.freeze({
  VERSION: 0x01,
  HEADER_SIZE: 78,
  MAX_SIZE: 4 * 1024 * 1024,

  SIZES: Object.freeze({
    PUBKEY: 32,
    NONCE: 12,
    TAG: 16,
    MIN_PAYLOAD: 28,
  }),
});
