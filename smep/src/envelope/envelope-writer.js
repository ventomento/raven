// src/envelope/envelope-writer.js

import { BinaryWriter } from "./binary.js";
import { EnvelopeLayout } from "./layout.js";

const { HEADER_SIZE, MAX_SIZE, SIZES } = EnvelopeLayout;

// Writes an envelope into one buffer in two steps, so the header exists as
// bytes before encryption and is serialized only once:
//
//   const writer = new EnvelopeWriter(EnvelopeWriter.size(ciphertextLength));
//   const header = writer.writeHeader(fields);   // the AES-GCM aad
//   writer.writeBody({ aes_gcm_iv, ciphertext_with_tag });
//   return writer.finish();
export class EnvelopeWriter {
  #writer;

  // Byte size of an envelope whose ciphertext (without tag) is ciphertextLength.
  // Throws if that envelope would exceed MAX_SIZE.
  static size(ciphertextLength) {
    if (!Number.isInteger(ciphertextLength) || ciphertextLength < 0) {
      throw new Error("ciphertextLength must be a non-negative integer");
    }

    const byteSize = HEADER_SIZE + SIZES.MIN_PAYLOAD + ciphertextLength;

    if (byteSize > MAX_SIZE) {
      throw new Error("Envelope too large");
    }

    return byteSize;
  }

  constructor(byteSize) {
    if (!Number.isInteger(byteSize) || byteSize < HEADER_SIZE + SIZES.MIN_PAYLOAD) {
      throw new Error("byteSize too small for an envelope");
    }

    if (byteSize > MAX_SIZE) {
      throw new Error("Envelope too large");
    }

    this.#writer = new BinaryWriter(byteSize);
  }

  // Writes the header; payload_size is taken from the buffer size.
  // Returns a view of the written header bytes.
  writeHeader(fields) {
    this.#expectOffset(0, "writeHeader");
    validateHeaderFields(fields);

    const w = this.#writer;

    w.u8(EnvelopeLayout.VERSION);
    w.bytes(fields.sender_public_key);
    w.bytes(fields.recipient_public_key);
    w.u64(fields.timestamp);
    w.u8(fields.content_type);
    w.u32(w.buffer.byteLength - HEADER_SIZE);

    return w.written();
  }

  // The body must fill the rest of the buffer exactly.
  writeBody({ aes_gcm_iv, ciphertext_with_tag }) {
    this.#expectOffset(HEADER_SIZE, "writeBody");

    const remaining = this.#writer.buffer.byteLength - HEADER_SIZE - SIZES.NONCE;

    expectBytes(aes_gcm_iv, SIZES.NONCE, "aes_gcm_iv");
    expectBytes(ciphertext_with_tag, remaining, "ciphertext_with_tag");

    this.#writer.bytes(aes_gcm_iv);
    this.#writer.bytes(ciphertext_with_tag);
  }

  // Returns the envelope. Throws unless header and body were both written.
  finish() {
    return this.#writer.finish();
  }

  #expectOffset(offset, step) {
    if (this.#writer.offset !== offset) {
      throw new Error(`${step} called out of order`);
    }
  }
}

function validateHeaderFields(fields) {
  if (!fields) throw new Error("Missing header fields");

  expectBytes(fields.sender_public_key, SIZES.PUBKEY, "sender_public_key");
  expectBytes(fields.recipient_public_key, SIZES.PUBKEY, "recipient_public_key");

  if (
    typeof fields.timestamp !== "bigint" ||
    fields.timestamp < 0n ||
    fields.timestamp > 0xFFFFFFFFFFFFFFFFn
  ) {
    throw new Error("timestamp must be uint64");
  }

  if (
    !Number.isInteger(fields.content_type) ||
    fields.content_type < 0 ||
    fields.content_type > 255
  ) {
    throw new Error("content_type must be uint8");
  }
}

function expectBytes(value, length, name) {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${name} must be Uint8Array`);
  }
  if (value.length !== length) {
    throw new Error(`${name} must be ${length} bytes`);
  }
}
