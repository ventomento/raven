// src/envelope/layout.js

// SMEP envelope layout (smep_rfc.txt section 4).
//
//   header:  version | uuid | sender_public_key | recipient_public_key
//            | timestamp | content_type | payload_size      (94 bytes)
//   body:    iv | ciphertext || tag                          (payload_size bytes)

export const EnvelopeLayout = Object.freeze({
  VERSION: 0x02,
  HEADER_SIZE: 94,

  SIZES: Object.freeze({
    UUID: 16,
    PUBKEY: 32,
    NONCE: 12,
    TAG: 16,
    MIN_PAYLOAD: 28,
  }),
});
