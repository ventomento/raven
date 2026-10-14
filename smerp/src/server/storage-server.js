import { insist } from "../../../smep/src/util/util.js";

// In-memory, append-only envelope store for the mock relay (smerp-server.js).
// It never deletes, so the mock behaves like an "archive" relay (smerp_rfc
// section 2). An envelope is held only if its hash (sha256 of the complete
// bytes) is, never because a header field matches (smerp_rfc section 5).
// Record ids start at 1 and serve as the download cursor.
export class StorageServer {

    constructor() {
        this.records = [];
        this.idsByHash = new Map();
        this.nextId = 1;
        Object.seal(this);
    }

    has(hash) {
        return this.idsByHash.has(hash);
    }

    // Stores the envelope and returns its record. An envelope already held
    // is not stored again; its existing record is returned.
    envelopesPut({ hash, spkh, rpkh, bytes }) {
        insist(hash, "string");
        insist(spkh, "string");
        insist(rpkh, "string");
        insist(bytes, ArrayBuffer);

        if (this.has(hash)) {
            return this.records[this.idsByHash.get(hash) - 1];
        }

        const record = Object.freeze({ id: this.nextId++, hash, spkh, rpkh, bytes });

        this.records.push(record);
        this.idsByHash.set(hash, record.id);

        return record;
    }

    // Records after `after` (a record id) sent by or to `pkh`, in id order.
    // Without a pkh, every record.
    envelopesGet({ pkh = null, after = 0 } = {}) {
        if (pkh === null) {
            return [...this.records];
        }

        return this.records.filter(record =>
            record.id > after && (record.spkh === pkh || record.rpkh === pkh)
        );
    }
}
