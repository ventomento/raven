// src/server/storage-server.js

export class StorageServer {

  constructor() {

    // ordered append-only record store
    this.records = [];

    // monotonically increasing integer id
    this.nextId = 1;

    // uuid uniqueness index
    this.uuidIndex = Object.create(null);

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
    uuid, // universal unique identifier.
    spkh, //senderPublicKeyhex
    rpkh, //recipientPublicKeyHex
    eb, //envelopeBytes
  }) {

    // ------------------------------------------------------------
    // validation
    // ------------------------------------------------------------

    if (typeof uuid !== "string") {
      throw new Error(
        "uuid must be string"
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
    // enforce uuid uniqueness
    // ------------------------------------------------------------

    if (this.uuidIndex[uuid]) {
      throw new Error(
        "duplicate uuid"
      );
    }

    // ------------------------------------------------------------
    // create immutable record
    // ------------------------------------------------------------

    const record = Object.freeze({
      id: this.nextId++,
      uuid,
      spkh,
      rpkh,
      eb,
    });

    // ------------------------------------------------------------
    // store
    // ------------------------------------------------------------

    this.records.push(record);
    this.uuidIndex[uuid] = record.id;

    return record;
  }

  // ============================================================
  // QUERY ENVELOPES
  // ============================================================

  envelopesGet(options = {}) {
    const { pkh = null, id = 0 } = options;

    /*
    if (typeof pkh !== "string") {
      throw new Error(
        "pkh must be string"
      );
    }

    if (!Number.isInteger(id)) {
      throw new Error(
        "id must be integer"
      );
    }*/

    if (!pkh) {
      return this.records;
    }

    /*
    return this.records.filter(
      (record) =>
        record.id > id &&
        (
          record.spkh === pkh ||
          record.rpkh === pkh
        )
    );*/

    // Find the next record (smallest id > current id)
    const nextRecord = this.records
      .filter((record) =>
        record.id > id &&
        (record.spkh === pkh || record.rpkh === pkh)
      )
      .sort((a, b) => a.id - b.id)   // sort ascending by id
      [0];                           // take only the first one (the next)

    return nextRecord ? [nextRecord] : [];   // ← Always return array!
  }

}