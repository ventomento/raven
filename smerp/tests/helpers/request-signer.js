import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/internal.js";
import { RealClock } from "../../src/lib/clock.js";
import { hmacKeyFor, signTarget } from "../../src/auth/request-signer.js";

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

    async target({ method, target, body }) {

        return signTarget({
            method,
            target,
            body,
            pkh: await this.#pkh(),
            timestamp: this.#timestamp(),
            hmacKey: await this.#key(),
        });
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
