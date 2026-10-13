// src/server/storage-server.js

export class StorageServer {

  constructor() {

    // ordered append-only record store
    this.records = [];

    // monotonically increasing integer id
    this.nextId = 1;

    // envelope hash uniqueness index
    this.hashIndex = Object.create(null);

    // ============================================================
    // INTENTS
    // ============================================================
    this.intents = Object.create(null);

    Object.seal(this);
  }

  // ============================================================
  // STORE ENVELOPE
  // ============================================================

  envelopesPost({
    hash, // envelope hash: hex sha256 of the envelope bytes
    spkh, //senderPublicKeyhex
    rpkh, //recipientPublicKeyHex
    eb, //envelopeBytes
  }) {

    // ------------------------------------------------------------
    // validation
    // ------------------------------------------------------------

    if (typeof hash !== "string") {
      throw new Error(
        "hash must be string"
      );
    }

    if (typeof spkh !== "string") {
      throw new Error(
        "spkh must be string"
      );
    }

    if (typeof rpkh !== "string") {
      throw new Error(
        "rpkh must be string"
      );
    }

    if (!(eb instanceof ArrayBuffer)) {
      throw new Error(
        "envelopeBytes must be Uint8Array"
      );
    }

    // ------------------------------------------------------------
    // enforce hash uniqueness
    // ------------------------------------------------------------

    if (this.hashIndex[hash]) {
      throw new Error(
        "duplicate envelope"
      );
    }

    // ------------------------------------------------------------
    // create immutable record
    // ------------------------------------------------------------

    const record = Object.freeze({
      id: this.nextId++,
      hash,
      spkh,
      rpkh,
      eb,
    });

    // ------------------------------------------------------------
    // store
    // ------------------------------------------------------------

    this.records.push(record);
    this.hashIndex[hash] = record.id;

    return record;
  }

  // ============================================================
  // QUERY ENVELOPES
  // ============================================================

  // Records of mailbox pkh after id, in id order. Without pkh, every
  // record.
  envelopesGet(options = {}) {
    const { pkh = null, id = 0 } = options;

    if (!pkh) {
      return this.records;
    }

    // records is append-only, so already in id order.
    return this.records.filter((record) =>
      record.id > id &&
      (record.spkh === pkh || record.rpkh === pkh)
    );
  }

}