import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { deriveSharedSecret } from "../../../smep/src/crypto/x25519.js";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf.js";
import { sha256 } from "../../../smep/src/crypto/hash.js";
import { verifyHmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { bytesToHex, hexToBytes } from "../../../smep/src/encoding/hex.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { RealClock } from "../lib/clock.js";

export const AuthHeaders = Object.freeze({
    pkh: "x-smerp-pkh",
    timestamp: "x-smerp-timestamp",
    signature: "x-smerp-signature",
    token: "x-smerp-token",
});

export function canonicalRequest({ method, target, timestamp, bodyHashHex }) {

    insist(method, "string");
    insist(target, "string");
    insist(timestamp, "string");
    insist(bodyHashHex, "string");

    return `${method}\n${target}\n${timestamp}\n${bodyHashHex}`;
}

export async function bodyHashHex(body) {

    return bytesToHex(await sha256(toBytes(body)));
}

export async function hmacKeyFor(privateIdentity, publicIdentity) {

    insist(privateIdentity, PrivateIdentity);
    insist(publicIdentity, PublicIdentity);

    const sharedSecret = await deriveSharedSecret(
        privateIdentity.privateKey,
        publicIdentity.publicKey
    );

    return deriveHmacKey(sharedSecret);
}

export function normalizePkh(value) {

    if (typeof value !== "string") {
        return null;
    }

    const pkh = value.trim().replace(/^0x/i, "").toLowerCase();

    return /^[0-9a-f]{64}$/.test(pkh) ? pkh : null;
}

export class RequestVerifier {

    static MAX_CACHED_KEYS = 1000;

    constructor({
        identity,
        clock = RealClock,
        maxSkewSeconds = 300,
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.clock = clock;
        this.maxSkewSeconds = maxSkewSeconds;
        this.keys = new Map();
    }

    async verify({ method, target, headers, body }) {

        const auth = this.#readHeaders(headers);

        if (!auth) {
            return { ok: false, reason: "missing signature" };
        }

        if (!this.#checkTimestamp(auth.timestamp)) {
            return { ok: false, reason: "timestamp out of window" };
        }

        const canonical = canonicalRequest({
            method,
            target,
            timestamp: auth.timestamp,
            bodyHashHex: await bodyHashHex(body),
        });

        try {
            const ok = await verifyHmacSha256(
                await this.#keyFor(auth.pkh),
                encodeUtf8(canonical),
                hexToBytes(auth.signature)
            );

            return ok
                ? { ok: true, pkh: auth.pkh }
                : { ok: false, reason: "invalid signature" };
        }
        catch {
            return { ok: false, reason: "invalid signature" };
        }
    }

    #readHeaders(headers = {}) {

        const pkh = normalizePkh(headers[AuthHeaders.pkh]);
        const timestamp = headers[AuthHeaders.timestamp];
        const signature = headers[AuthHeaders.signature];

        if (!pkh || typeof timestamp !== "string" || typeof signature !== "string") {
            return null;
        }

        return { pkh, timestamp, signature };
    }

    #checkTimestamp(timestamp) {

        const ts = Number(timestamp);
        const now = Math.floor(this.clock.now() / 1000);

        return Number.isInteger(ts) && Math.abs(now - ts) <= this.maxSkewSeconds;
    }

    async #keyFor(pkh) {

        let key = this.keys.get(pkh);

        if (!key) {

            key = await hmacKeyFor(this.identity, await PublicIdentity.fromPublicHex(pkh));

            if (this.keys.size >= RequestVerifier.MAX_CACHED_KEYS) {
                this.keys.delete(this.keys.keys().next().value);
            }

            this.keys.set(pkh, key);
        }

        return key;
    }
}

function toBytes(body) {

    if (body === undefined || body === null) {
        return new Uint8Array(0);
    }

    if (body instanceof Uint8Array) {
        return body;
    }

    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }

    throw new TypeError("body must be ArrayBuffer, Uint8Array or empty");
}
