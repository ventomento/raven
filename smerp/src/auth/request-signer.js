/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
    insist,
    PrivateIdentity,
    PublicIdentity,
    deriveSharedSecret,
    deriveHmacKey,
    sha256,
    hmacSha256,
    verifyHmacSha256,
    bytesToHex,
    hexToBytes,
    encodeUtf8,
} from "../../../smep/src/internal.js";
import { RealClock } from "../lib/clock.js";

// Query parameters, so a browser sends a signed request without a preflight
// (auth_rfc section 5). The signature is always last.
export const AuthParams = Object.freeze({
    pkh: "pkh",
    timestamp: "ts",
    signature: "sig",
});

const SIGNATURE_SEPARATOR = `&${AuthParams.signature}=`;

export function canonicalRequest({ method, signedTarget, bodyHashHex }) {

    insist(method, "string");
    insist(signedTarget, "string");
    insist(bodyHashHex, "string");

    return `${method}\n${signedTarget}\n${bodyHashHex}`;
}

// The target with the auth parameters appended, the signature covering all
// before it.
export async function signTarget({ method, target, body, pkh, timestamp, hmacKey }) {

    const separator = target.includes("?") ? "&" : "?";
    const signedTarget = `${target}${separator}${AuthParams.pkh}=${pkh}&${AuthParams.timestamp}=${timestamp}`;

    const canonical = canonicalRequest({
        method,
        signedTarget,
        bodyHashHex: await bodyHashHex(body),
    });

    const signature = await hmacSha256(hmacKey, encodeUtf8(canonical));

    return `${signedTarget}${SIGNATURE_SEPARATOR}${bytesToHex(signature)}`;
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
        maxSkewSeconds = 60,
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.clock = clock;
        this.maxSkewSeconds = maxSkewSeconds;
        this.keys = new Map();
    }

    // arrivedAt is when the request arrived, for a relay that reads the body
    // first: a slow upload must not outlive its timestamp (auth_rfc section 4).
    async verify({ method, target, body, arrivedAt = this.clock.now() }) {

        const auth = this.#readAuth(target);

        if (!auth) {
            return { ok: false, reason: "missing signature" };
        }

        if (!this.#checkTimestamp(auth.timestamp, arrivedAt)) {
            return { ok: false, reason: "timestamp out of window" };
        }

        const canonical = canonicalRequest({
            method,
            signedTarget: auth.signedTarget,
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

    #readAuth(target) {

        const at = target.lastIndexOf(SIGNATURE_SEPARATOR);
        const queryAt = target.indexOf("?");

        if (at === -1 || queryAt === -1) {
            return null;
        }

        const signedTarget = target.slice(0, at);
        const params = new URLSearchParams(signedTarget.slice(queryAt + 1));

        const pkh = normalizePkh(params.get(AuthParams.pkh));
        const timestamp = params.get(AuthParams.timestamp);

        if (!pkh || timestamp === null) {
            return null;
        }

        return {
            pkh,
            timestamp,
            signedTarget,
            signature: target.slice(at + SIGNATURE_SEPARATOR.length),
        };
    }

    #checkTimestamp(timestamp, arrivedAt) {

        const ts = Number(timestamp);
        const now = Math.floor(arrivedAt / 1000);

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
