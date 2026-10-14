export const EnvelopeLayout = Object.freeze({
  VERSION: 0x03,
  HEADER_SIZE: 78,
  MAX_SIZE: 4 * 1024 * 1024,

  SIZES: Object.freeze({
    PUBKEY: 32,
    NONCE: 12,
    TAG: 16,
    MIN_PAYLOAD: 28,
  }),
});
