import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { deriveSharedSecret } from "../../../smep/src/crypto/x25519.js";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf.js";
import { sha256 } from "../../../smep/src/crypto/hash.js";
import { hmacSha256, verifyHmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { bytesToHex, hexToBytes } from "../../../smep/src/encoding/hex.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { RealClock } from "../sync/rate-limiter.js";

// Request signing, spec: auth_rfc.txt. Every request to a relay is
// signed by one X25519 identity with an HMAC over the whole request.

export const AuthHeaders = Object.freeze({
    pkh: "x-smerp-pkh",
    timestamp: "x-smerp-timestamp",
    signature: "x-smerp-signature",
});

/**
 * The signed string. target is the path and query relative to the
 * relay URL, exactly as sent, e.g. "/envelopes?cursor=12".
 */
export function canonicalRequest({ method, target, timestamp, bodyHashHex }) {

    insist(method, "string");
    insist(target, "string");
    insist(timestamp, "string");
    insist(bodyHashHex, "string");

    return `${method}\n${target}\n${timestamp}\n${bodyHashHex}`;
}

// Hex sha256 of the body; no body hashes as zero bytes.
export async function bodyHashHex(body) {

    return bytesToHex(await sha256(toBytes(body)));
}

// HMAC key both sides derive: SHA256(X25519(private, public)).
export async function hmacKeyFor(privateIdentity, publicIdentity) {

    insist(privateIdentity, PrivateIdentity);
    insist(publicIdentity, PublicIdentity);

    const sharedSecret = await deriveSharedSecret(
        privateIdentity.privateKey,
        publicIdentity.publicKey
    );

    return deriveHmacKey(sharedSecret);
}

// Lowercase hex without "0x", or null unless it is 32 bytes of hex.
export function normalizePkh(value) {

    if (typeof value !== "string") {
        return null;
    }

    const pkh = value.trim().replace(/^0x/i, "").toLowerCase();

    return /^[0-9a-f]{64}$/.test(pkh) ? pkh : null;
}

/**
 * Client side: signs requests from one identity to one relay. The HMAC
 * key is derived once.
 */
export class RequestSigner {

    constructor({
        identity,
        relayPkh,
        clock = RealClock,
    }) {

        insist(identity, PrivateIdentity);
        insist(relayPkh, "string");

        this.identity = identity;
        this.relayPkh = relayPkh;
        this.clock = clock;
        this.keyPromise = null;
    }

    async headers({ method, target, body }) {

        const timestamp = this.#timestamp();

        const canonical = canonicalRequest({
            method,
            target,
            timestamp,
            bodyHashHex: await bodyHashHex(body),
        });

        const signature = await hmacSha256(await this.#key(), encodeUtf8(canonical));

        return {
            [AuthHeaders.pkh]: await this.#pkh(),
            [AuthHeaders.timestamp]: timestamp,
            [AuthHeaders.signature]: bytesToHex(signature),
        };
    }

    #timestamp() {
        return Math.floor(this.clock.now() / 1000).toString();
    }

    async #pkh() {
        return this.identity.publicKeyHex ?? this.identity.exportPublicHex();
    }

    #key() {

        this.keyPromise ??= PublicIdentity.fromPublicHex(this.relayPkh)
            .then(relay => hmacKeyFor(this.identity, relay));

        return this.keyPromise;
    }
}

/**
 * Relay side: verifies signed requests against the relay identity.
 * verify() never throws for bad input; it reports why it failed.
 */
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
        this.keys = new Map(); // signer pkh -> HMAC key
    }

    /**
     * headers: request headers with lowercase names.
     * Returns { ok: true, pkh } or { ok: false, reason }.
     */
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

        // A low-order pkh or non-hex signature throws: a failed signature.
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
