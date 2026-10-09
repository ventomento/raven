import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { symHmacKey, signedHeaders } from "./protocol.js";
import { RealClock } from "../sync/rate-limiter.js";

// Authentication Claim: I own the private key at timestamp.

export class Authenticator {

    constructor({
        identity,
        relay,
        clock = RealClock,
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.relay = relay;
        this.clock = clock;
        this._symKey = null;

    }

    async symKey() {

        if (this._symKey){
            return this._symKey;
        }
        
        const publicIdentity = await PublicIdentity.fromPublicHex(this.relay.relayPkh);

        this._symKey = await symHmacKey({
            privateIdentity : this.identity, 
            publicIdentity
        })

        return this._symKey;

    }

    async headers() {

        if (!this.relay.relayPkh) {
            throw new Error("Relay has no relayPkh: cannot authenticate");
        }

        const hmacKey = await this.symKey();

        return await signedHeaders(
            hmacKey,
            this.clock.now()
        )

    }

    
}