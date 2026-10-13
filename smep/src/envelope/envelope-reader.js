// src/envelope/envelope-reader.js

import { BinaryReader } from "./binary.js";
import { EnvelopeLayout } from "./layout.js";

const { HEADER_SIZE, MAX_SIZE, SIZES } = EnvelopeLayout;

// Parses an envelope without decrypting it. Returns a frozen object.
// header, aes_gcm_iv and ciphertext_with_tag are views into buffer, not
// copies; header is the bytes as received, the aad for decryption.
export function readEnvelope(buffer) {
  const r = new BinaryReader(buffer);

  if (buffer.byteLength > MAX_SIZE) {
    throw new Error("Envelope too large");
  }

  // ---- HEADER ----
  const version = r.u8();
  if (version !== EnvelopeLayout.VERSION) {
    throw new Error("Invalid version");
  }

  const sender_public_key = r.bytes(SIZES.PUBKEY);
  const recipient_public_key = r.bytes(SIZES.PUBKEY);
  const timestamp = r.u64();
  const content_type = r.u8();
  const payload_size = r.u32();

  const header = r.consumed();

  if (payload_size < SIZES.MIN_PAYLOAD) {
    throw new Error("payload_size too small");
  }

  if (buffer.byteLength !== HEADER_SIZE + payload_size) {
    throw new Error("Total size mismatch");
  }

  // ---- BODY ----
  const aes_gcm_iv = r.bytes(SIZES.NONCE, false);
  const ciphertext_with_tag = r.bytes(payload_size - SIZES.NONCE, false);

  return Object.freeze({
    version,
    sender_public_key,
    recipient_public_key,
    timestamp,
    content_type,
    payload_size,
    header,
    aes_gcm_iv,
    ciphertext_with_tag,
  });
}
