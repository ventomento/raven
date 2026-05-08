// src/envelope/binary-reader.js

export class BinaryReader {

  constructor(buffer) {

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("Expected ArrayBuffer");
    }

    this.buffer = buffer;
    this.view = new DataView(buffer);
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

  bytes(length, copy = true) {

    this.ensureAvailable(length);

    const view = new Uint8Array(
      this.buffer,
      this.offset,
      length
    );

    this.offset += length;

    return copy
      ? new Uint8Array(view)
      : view;
  }

}