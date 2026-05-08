class BinaryReader {
  constructor(buffer) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("Expected ArrayBuffer");
    }
    this.view = new DataView(buffer);
    this.buffer = buffer;
    this.offset = 0;
  }

  ensureAvailable(n) {
    if (this.offset + n > this.buffer.byteLength) {
      throw new Error("Buffer underflow");
    }
  }

  u8() {
    this.ensureAvailable(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u32() {
    this.ensureAvailable(4);
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  u64() {
    this.ensureAvailable(8);
    const v = this.view.getBigUint64(this.offset, false);
    this.offset += 8;
    return v;
  }

  bytes(len, copy = true) {
    this.ensureAvailable(len);

    const view = new Uint8Array(this.buffer, this.offset, len);
    this.offset += len;

    return copy ? new Uint8Array(view) : view;
  }
}

class BinaryWriter {
  constructor(size) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensureAvailable(n) {
    if (this.offset + n > this.buffer.byteLength) {
      throw new Error("Buffer overflow");
    }
  }

  u8(v) {
    this.ensureAvailable(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }

  u32(v) {
    this.ensureAvailable(4);
    this.view.setUint32(this.offset, v, false);
    this.offset += 4;
  }

  u64(v) {
    this.ensureAvailable(8);
    this.view.setBigUint64(this.offset, BigInt(v), false);
    this.offset += 8;
  }

  bytes(arr, expectedLength = null) {
    if (!(arr instanceof Uint8Array)) {
      throw new Error("Expected Uint8Array");
    }

    if (expectedLength !== null && arr.length !== expectedLength) {
      throw new Error(`Invalid length (expected ${expectedLength})`);
    }

    this.ensureAvailable(arr.length);

    new Uint8Array(this.buffer, this.offset, arr.length).set(arr);
    this.offset += arr.length;
  }

  finish() {
    if (this.offset !== this.buffer.byteLength) {
      throw new Error("Writer did not fill buffer exactly");
    }
    return this.buffer;
  }
}

export class Serializer {
  // ===== CONSTANTS =====
  static VERSION = 0x01;
  static HEADER_SIZE = 94;

  static SIZES = {
    UUID: 16,
    PUBKEY: 32,
    NONCE: 12,
    TAG: 16,
    MIN_PAYLOAD: 28,
  };

  // =========================
  // PUBLIC: UNPACK RESPONSE
  // =========================
  static async unpack(response) {
    if (!response || typeof response.arrayBuffer !== "function") {
      throw new Error("Invalid Response");
    }
    const buffer = await response.arrayBuffer();
    return this.unpackBuffer(buffer);
  }

  // =========================
  // PUBLIC: UNPACK BUFFER
  // =========================
  static unpackBuffer(buffer) {
    const r = new BinaryReader(buffer);

    // ---- HEADER ----
    const version = r.u8();
    if (version !== this.VERSION) {
      throw new Error("Invalid version");
    }

    const uuid = r.bytes(this.SIZES.UUID);
    const sender_public_key = r.bytes(this.SIZES.PUBKEY);
    const recipient_public_key = r.bytes(this.SIZES.PUBKEY);
    const timestamp = r.u64();
    const content_type = r.u8();
    const payload_size = r.u32();

    if (r.offset !== this.HEADER_SIZE) {
      throw new Error("Header size mismatch");
    }

    if (payload_size < this.SIZES.MIN_PAYLOAD) {
      throw new Error("payload_size too small");
    }

    if (buffer.byteLength !== this.HEADER_SIZE + payload_size) {
      throw new Error("Total size mismatch");
    }

    // ---- PAYLOAD ----
    const aes_gcm_iv = r.bytes(this.SIZES.NONCE);

    const ciphertextLength =
      payload_size - this.SIZES.NONCE - this.SIZES.TAG;

    if (ciphertextLength < 0) {
      throw new Error("Invalid ciphertext length");
    }

    const ciphertext = r.bytes(ciphertextLength);
    const auth_tag = r.bytes(this.SIZES.TAG);

    if (r.offset !== buffer.byteLength) {
      throw new Error("Trailing data detected");
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

  // =========================
  // PUBLIC: PACK OBJECT
  // =========================
  static pack(obj) {
    this._validate(obj);

    const payload_size =
      this.SIZES.NONCE +
      obj.ciphertext.length +
      this.SIZES.TAG;

    const totalSize = this.HEADER_SIZE + payload_size;

    const w = new BinaryWriter(totalSize);

    // ---- HEADER ----
    w.u8(this.VERSION);
    w.bytes(obj.uuid, this.SIZES.UUID);
    w.bytes(obj.sender_public_key, this.SIZES.PUBKEY);
    w.bytes(obj.recipient_public_key, this.SIZES.PUBKEY);
    w.u64(obj.timestamp);
    w.u8(obj.content_type);
    w.u32(payload_size);

    // ---- PAYLOAD ----
    w.bytes(obj.aes_gcm_iv, this.SIZES.NONCE);
    w.bytes(obj.ciphertext);
    w.bytes(obj.auth_tag, this.SIZES.TAG);

    return w.finish();
  }

  // =========================
  // VALIDATION
  // =========================
  static _validate(obj) {
    if (!obj) throw new Error("Missing object");

    this._expectBytes(obj.uuid, this.SIZES.UUID, "uuid");
    this._expectBytes(obj.sender_public_key, this.SIZES.PUBKEY, "sender_public_key");
    this._expectBytes(obj.recipient_public_key, this.SIZES.PUBKEY, "recipient_public_key");
    this._expectBytes(obj.aes_gcm_iv, this.SIZES.NONCE, "aes_gcm_iv");
    this._expectBytes(obj.auth_tag, this.SIZES.TAG, "auth_tag");

    if (!(obj.ciphertext instanceof Uint8Array)) {
      throw new Error("ciphertext must be Uint8Array");
    }

    if (
      typeof obj.timestamp !== "bigint" ||
      obj.timestamp < 0n ||
      obj.timestamp > 0xFFFFFFFFFFFFFFFFn
    ) {
      throw new Error("timestamp must be uint64");
    }

    if (
      !Number.isInteger(obj.content_type) ||
      obj.content_type < 0 ||
      obj.content_type > 255
    ) {
      throw new Error("content_type must be uint8");
    }
  }

  static _expectBytes(value, len, name) {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${name} must be Uint8Array`);
    }
    if (value.length !== len) {
      throw new Error(`${name} must be ${len} bytes`);
    }
  }
}
