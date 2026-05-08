// src/envelope/constants.js

export const VERSION = 0x01;

export const HEADER_SIZE = 94;

export const SIZES = Object.freeze({
  UUID: 16,
  PUBKEY: 32,
  NONCE: 12,
  TAG: 16,
  MIN_PAYLOAD: 28,
});