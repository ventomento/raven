import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { hmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { RealClock } from "../../src/lib/clock.js";
import { AuthHeaders, bodyHashHex, canonicalRequest, hmacKeyFor } from "../../src/auth/request-signer.js";

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
