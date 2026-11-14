// ============================================================================
//  MOCK RELAY: FOR DEVELOPMENT AND TESTS ONLY.
//
//  This server must NOT, under any circumstances, be used in production or
//  exposed to a network. It exists so tests, the REPL and the web UI demo
//  have a relay to talk to. Among other things it:
//    - keeps every envelope in memory only (lost on restart, unbounded growth;
//      a restart gets a new epoch, so clients notice and fetch again),
//    - has no rate limits and never answers 429,
//    - does not federate (smerp_rfc section 5) and never deletes envelopes,
//    - serves GET /dump: every stored envelope's metadata, without auth.
// ============================================================================

import http from "node:http";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { PrivateIdentity, readEnvelope, envelopeHash } from "../../../smep/src/index.js";
import { RequestVerifier } from "../../src/auth/request-signer.js";
import { RealClock } from "../../src/lib/clock.js";
import { SmerpHeaders, Status, MAX_ENVELOPE_BYTES, MAX_BATCH_BYTES, encodeBatch } from "../../src/protocol/index.js";
import { StorageServer } from "./storage-server.js";
import { setCorsHeaders, send, readBody, parseCursorParam } from "./http-helpers.js";

const NOT_FOUND = 404;
const INTERNAL_ERROR = 500;

const OCTET_STREAM = "application/octet-stream";

export class SmerpServer {

    constructor({ storage = new StorageServer(), privateKeyHex = null, clock = RealClock } = {}) {
        this.storage = storage;
        this.clock = clock;
        this.identityPromise = null;
        this.verifierPromise = null;

        this.useIdentity(
            privateKeyHex === null
                ? PrivateIdentity.generate()
                : PrivateIdentity.fromPrivateKeyHex(privateKeyHex)
        );

        this.routes = {
            "GET /": this.handleRoot,
            "GET /dump": this.handleDump,
            "GET /envelopes": this.handleEnvelopesGet,
            "POST /envelopes": this.handleEnvelopesPost,
        };

        this.server = http.createServer((req, res) => this.handleRequest(req, res));

        Object.seal(this);
    }

    listen(port, host = "127.0.0.1") {
        return new Promise(resolve => this.server.listen(port, host, resolve));
    }

    close() {
        return new Promise((resolve, reject) => {
            this.server.close(error => (error ? reject(error) : resolve()));
        });
    }

    async relayPkh() {
        return (await this.identityPromise).publicKeyHex;
    }

    rotateKey() {
        this.useIdentity(PrivateIdentity.generate());
        return this.relayPkh();
    }

    useIdentity(identityPromise) {
        this.identityPromise = identityPromise;
        this.verifierPromise = identityPromise.then(identity => new RequestVerifier({ identity, clock: this.clock }));
    }

    async handleRequest(req, res) {
        try {
            // Every response carries the relay key, the epoch and the CORS
            // headers (smerp_rfc sections 1 and 4).
            res.setHeader(SmerpHeaders.relayPkh, await this.relayPkh());
            res.setHeader(SmerpHeaders.epoch, this.storage.epoch);
            setCorsHeaders(res);

            const url = new URL(req.url, "http://localhost");
            const handler = this.routes[`${req.method} ${url.pathname}`];

            if (handler === undefined) {
                send(res, NOT_FOUND);
                return;
            }

            await handler.call(this, req, res, url);

        } catch (error) {
            console.error(error);
            send(res, INTERNAL_ERROR);
        }
    }

    handleRoot(req, res) {
        send(res, Status.OK, {
            headers: { "Content-Type": "text/plain" },
            body: "Hello from smerp server, I am running!",
        });
    }

    handleDump(req, res) {
        const records = this.storage.envelopesGet().map(({ id, hash, spkh, rpkh, bytes }) =>
            ({ id, hash, spkh, rpkh, size: bytes.byteLength })
        );

        send(res, Status.OK, {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(records, null, 2),
        });
    }

    // POST /envelopes (smerp_rfc section 3).
    async handleEnvelopesPost(req, res) {
        // The timestamp is checked against this, not the end of the upload.
        const arrivedAt = this.clock.now();

        if (Number(req.headers["content-length"]) > MAX_ENVELOPE_BYTES) {
            send(res, Status.BAD_REQUEST);
            req.resume();
            return;
        }

        const bytes = await readBody(req, MAX_ENVELOPE_BYTES);

        if (bytes === null) {
            send(res, Status.BAD_REQUEST);
            return;
        }

        const auth = await this.authenticate(req, bytes, arrivedAt);

        if (!auth.ok) {
            this.sendUnauthorized(res, auth.reason);
            return;
        }

        let envelope;
        try {
            envelope = readEnvelope(bytes);
        } catch {
            send(res, Status.BAD_REQUEST);
            return;
        }

        const spkh = bytesToHex(envelope.sender_public_key);
        const rpkh = bytesToHex(envelope.recipient_public_key);

        if (auth.pkh !== spkh && auth.pkh !== rpkh) {
            this.sendUnauthorized(res, "signer is neither sender nor recipient");
            return;
        }

        // An envelope already held is accepted too, and stored once.
        this.storage.envelopesPut({ hash: await envelopeHash(bytes), spkh, rpkh, bytes });

        send(res, Status.OK);
    }

    // GET /envelopes?cursor=N (smerp_rfc section 4). The mailbox is the signer's.
    async handleEnvelopesGet(req, res, url) {
        const auth = await this.authenticate(req);

        if (!auth.ok) {
            this.sendUnauthorized(res, auth.reason);
            return;
        }

        const cursor = parseCursorParam(url.searchParams.get("cursor"));

        if (cursor === null) {
            send(res, Status.BAD_REQUEST);
            return;
        }

        const batch = fillBatch(this.storage.envelopesGet({ pkh: auth.pkh, after: cursor }));

        if (batch.length === 0) {
            send(res, Status.NO_CONTENT);
            return;
        }

        send(res, Status.OK, {
            headers: {
                "Content-Type": OCTET_STREAM,
                [SmerpHeaders.cursor]: batch[batch.length - 1].id,
            },
            body: encodeBatch(batch.map(record => record.bytes)),
        });
    }

    // The signature (auth_rfc section 8). Resolves { ok: true, pkh } or
    // { ok: false, reason }.
    async authenticate(req, body, arrivedAt) {
        const verifier = await this.verifierPromise;

        return verifier.verify({ method: req.method, target: req.url, body, arrivedAt });
    }

    sendUnauthorized(res, reason) {
        send(res, Status.UNAUTHORIZED, { headers: { [SmerpHeaders.unauthorized]: reason } });
    }
}

// The records from the start that fit in one batch: at most MAX_BATCH_BYTES of
// envelopes, framing not counted, but always the first (smerp_rfc section 4).
function fillBatch(records) {
    const batch = [];
    let size = 0;

    for (const record of records) {
        size += record.bytes.byteLength;

        if (batch.length > 0 && size > MAX_BATCH_BYTES) {
            break;
        }

        batch.push(record);
    }

    return batch;
}
