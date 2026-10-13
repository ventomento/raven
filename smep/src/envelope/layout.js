// src/envelope/layout.js

// SMEP envelope layout (smep_rfc.txt section 4).
//
//   header:  version | sender_public_key | recipient_public_key
//            | timestamp | content_type | payload_size      (78 bytes)
//   body:    iv | ciphertext || tag                          (payload_size bytes)

export const EnvelopeLayout = Object.freeze({
  VERSION: 0x03,
  HEADER_SIZE: 78,
  // Largest total envelope length, header included (4 MiB).
  MAX_SIZE: 4 * 1024 * 1024,

  SIZES: Object.freeze({
    PUBKEY: 32,
    NONCE: 12,
    TAG: 16,
    MIN_PAYLOAD: 28,
  }),
});
