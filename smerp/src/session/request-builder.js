import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { hmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { RealClock } from "../lib/clock.js";
import {
    AuthHeaders,
    canonicalRequest,
    bodyHashHex,
    hmacKeyFor,
} from "../auth/request-signer.js";

/**
 * Builds the complete, signed requests of the smerp protocol to one relay,
 * in the shape transporter.transport() takes:
 *
 *   { url, options: { method, headers, body? }, timeout }
 *
 * Sends nothing. relayUrl, relayToken and identity are fixed; the relay
 * key is passed per request, since the session learns it from responses.
 * A request without a relay key is unsigned (first contact, auth_rfc
 * section 7).
 */
export class RequestBuilder {

    static DEFAULTS = Object.freeze({
        timeoutMs: 30 * 1000,
    });

    constructor({
        relayUrl,
        relayToken = null,
        identity,
        clock = RealClock,
    }) {

        insist(relayUrl, "string");
        insist(identity, PrivateIdentity);

        this.relayUrl = relayUrl;
        this.relayToken = relayToken;
        this.identity = identity;
        this.clock = clock;

        // HMAC key for one relay key: { relayPkh, keyPromise }
        this.cachedKey = null;
    }

    // GET /envelopes?cursor=<cursor> (smerp_rfc section 4)
    buildGet(cursor, relayPkh) {

        return this.build({
            method: "GET",
            target: `/envelopes?cursor=${cursor}`,
        }, relayPkh);
    }

    // POST /envelopes (smerp_rfc section 3)
    buildPost(envelopeBytes, relayPkh) {

        return this.build({
            method: "POST",
            target: "/envelopes",
            body: envelopeBytes,
            headers: { "content-type": "application/octet-stream" },
        }, relayPkh);
    }

    // =====================================================
    // Internal
    // =====================================================

    // target is the path and query relative to relayUrl: what gets signed.
    async build({ method, target, body, headers = {} }, relayPkh) {

        const auth = relayPkh
            ? await this.authHeaders({ method, target, body }, relayPkh)
            : {};

        return {
            url: `${this.relayUrl}${target}`,
            options: {
                method,
                headers: {
                    ...headers,
                    ...auth,
                    ...(this.relayToken && { authorization: `Bearer ${this.relayToken}` }),
                },
                ...(body !== undefined && { body }),
            },
            timeout: RequestBuilder.DEFAULTS.timeoutMs,
        };
    }

    // x-smerp-pkh, x-smerp-timestamp, x-smerp-signature (auth_rfc section 5)
    async authHeaders({ method, target, body }, relayPkh) {

        const timestamp = Math.floor(this.clock.now() / 1000).toString();

        const canonical = canonicalRequest({
            method,
            target,
            timestamp,
            bodyHashHex: await bodyHashHex(body),
        });

        const signature = await hmacSha256(await this.hmacKey(relayPkh), encodeUtf8(canonical));

        return {
            [AuthHeaders.pkh]: this.identity.publicKeyHex ?? await this.identity.exportPublicHex(),
            [AuthHeaders.timestamp]: timestamp,
            [AuthHeaders.signature]: bytesToHex(signature),
        };
    }

    // Derived once per relay key; a new relay key (rotation) derives again.
    hmacKey(relayPkh) {

        if (this.cachedKey?.relayPkh !== relayPkh) {
            this.cachedKey = {
                relayPkh,
                keyPromise: PublicIdentity.fromPublicHex(relayPkh)
                    .then(relay => hmacKeyFor(this.identity, relay)),
            };
        }

        return this.cachedKey.keyPromise;
    }
}
