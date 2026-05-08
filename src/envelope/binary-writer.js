// src/envelope/binary-writer.js

export class BinaryWriter {

  constructor(size) {

    if (!Number.isInteger(size) || size <= 0) {
      throw new Error("Invalid size");
    }

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

    if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) {
      throw new Error("Invalid uint32");
    }

    this.ensureAvailable(4);

    this.view.setUint32(this.offset, v, false);

    this.offset += 4;
  }

  u64(v) {

    if (
      typeof v !== "bigint" ||
      v < 0n ||
      v > 0xFFFFFFFFFFFFFFFFn
    ) {
      throw new Error("Invalid uint64");
    }

    this.ensureAvailable(8);

    this.view.setBigUint64(
      this.offset,
      v,
      false
    );

    this.offset += 8;
  }

  bytes(bytes, expectedLength = null) {

    if (!(bytes instanceof Uint8Array)) {
      throw new Error("Expected Uint8Array");
    }

    if (
      expectedLength !== null &&
      bytes.length !== expectedLength
    ) {
      throw new Error(
        `Expected ${expectedLength} bytes`
      );
    }

    this.ensureAvailable(bytes.length);

    new Uint8Array(
      this.buffer,
      this.offset,
      bytes.length
    ).set(bytes);

    this.offset += bytes.length;
  }

  finish() {

    if (this.offset !== this.buffer.byteLength) {
      throw new Error(
        "Writer did not fill buffer exactly"
      );
    }

    return this.buffer;
  }

}