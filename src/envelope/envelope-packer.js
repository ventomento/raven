// src/envelope/envelope-packer.js

import {
  VERSION,
  HEADER_SIZE,
  SIZES
} from "./constants.js";

import { BinaryReader } from "./binary-reader.js";
import { BinaryWriter } from "./binary-writer.js";

export class EnvelopePacker {

  // =========================================
  // PACK
  // =========================================

  static pack(envelope) {
    // envelope a js dict mimiking envelope specifications.

    this.#validate(envelope);

    const payload_size =
      SIZES.NONCE +
      envelope.ciphertext.length +
      SIZES.TAG;

    const totalSize =
      HEADER_SIZE + payload_size;

    const w = new BinaryWriter(totalSize);

    // ---- HEADER ----

    w.u8(VERSION);

    w.bytes(
      envelope.uuid,
      SIZES.UUID
    );

    w.bytes(
      envelope.sender_public_key,
      SIZES.PUBKEY
    );

    w.bytes(
      envelope.recipient_public_key,
      SIZES.PUBKEY
    );

    w.u64(envelope.timestamp);

    w.u8(envelope.content_type);

    w.u32(payload_size);

    // ---- PAYLOAD ----

    w.bytes(
      envelope.aes_gcm_iv,
      SIZES.NONCE
    );

    w.bytes(envelope.ciphertext);

    w.bytes(
      envelope.auth_tag,
      SIZES.TAG
    );

    return w.finish();
  }

  // =========================================
  // UNPACK ARRAYBUFFER
  // =========================================

  static unpack(buffer) {

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("Expected ArrayBuffer");
    }

    const r = new BinaryReader(buffer);

    // ---- HEADER ----

    const version = r.u8();

    if (version !== VERSION) {
      throw new Error("Invalid version");
    }

    const uuid = r.bytes(SIZES.UUID);

    const sender_public_key =
      r.bytes(SIZES.PUBKEY);

    const recipient_public_key =
      r.bytes(SIZES.PUBKEY);

    const timestamp = r.u64();

    const content_type = r.u8();

    const payload_size = r.u32();

    if (r.offset !== HEADER_SIZE) {
      throw new Error("Header size mismatch");
    }

    if (payload_size < SIZES.MIN_PAYLOAD) {
      throw new Error(
        "payload_size too small"
      );
    }

    if (
      buffer.byteLength !==
      HEADER_SIZE + payload_size
    ) {
      throw new Error(
        "Total size mismatch"
      );
    }

    // ---- PAYLOAD ----

    const aes_gcm_iv =
      r.bytes(SIZES.NONCE);

    const ciphertextLength =
      payload_size -
      SIZES.NONCE -
      SIZES.TAG;

    if (ciphertextLength < 0) {
      throw new Error(
        "Invalid ciphertext length"
      );
    }

    const ciphertext =
      r.bytes(ciphertextLength);

    const auth_tag =
      r.bytes(SIZES.TAG);

    if (r.offset !== buffer.byteLength) {
      throw new Error(
        "Trailing data detected"
      );
    }

    return Object.freeze({
      version,
      uuid,
      sender_public_key,
      recipient_public_key,
      timestamp,
      content_type,
      payload_size,
      aes_gcm_iv,
      ciphertext,
      auth_tag,
    });
  }

  // =========================================
  // UNPACK RESPONSE
  // =========================================

  static async unpackResponse(response) {

    if (
      !response ||
      typeof response.arrayBuffer !== "function"
    ) {
      throw new Error("Invalid Response");
    }

    const buffer =
      await response.arrayBuffer();

    return this.unpack(buffer);
  }

  // =========================================
  // VALIDATION
  // =========================================

  static #validate(obj) {

    if (!obj) {
      throw new Error("Missing envelope");
    }

    this.#expectBytes(
      obj.uuid,
      SIZES.UUID,
      "uuid"
    );

    this.#expectBytes(
      obj.sender_public_key,
      SIZES.PUBKEY,
      "sender_public_key"
    );

    this.#expectBytes(
      obj.recipient_public_key,
      SIZES.PUBKEY,
      "recipient_public_key"
    );

    this.#expectBytes(
      obj.aes_gcm_iv,
      SIZES.NONCE,
      "aes_gcm_iv"
    );

    this.#expectBytes(
      obj.auth_tag,
      SIZES.TAG,
      "auth_tag"
    );

    if (
      !(obj.ciphertext instanceof Uint8Array)
    ) {
      throw new Error(
        "ciphertext must be Uint8Array"
      );
    }

    if (
      typeof obj.timestamp !== "bigint" ||
      obj.timestamp < 0n ||
      obj.timestamp > 0xFFFFFFFFFFFFFFFFn
    ) {
      throw new Error(
        "timestamp must be uint64"
      );
    }

    if (
      !Number.isInteger(obj.content_type) ||
      obj.content_type < 0 ||
      obj.content_type > 255
    ) {
      throw new Error(
        "content_type must be uint8"
      );
    }
  }

  static #expectBytes(
    value,
    length,
    name
  ) {

    if (!(value instanceof Uint8Array)) {
      throw new Error(
        `${name} must be Uint8Array`
      );
    }

    if (value.length !== length) {
      throw new Error(
        `${name} must be ${length} bytes`
      );
    }
  }

}