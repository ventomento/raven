export class BinaryReader {
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

  consumed() {
    return new Uint8Array(this.buffer, 0, this.offset);
  }
}

export class BinaryWriter {
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

  written() {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  finish() {
    if (this.offset !== this.buffer.byteLength) {
      throw new Error("Writer did not fill buffer exactly");
    }
    return this.buffer;
  }
}
