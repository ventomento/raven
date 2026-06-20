import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { symHmacKey, makeHeaders, signedHeaders } from "./protocol.js";

// Authentication Claim: I own the private key at timestamp.

export class Authenticator {

    constructor({
        identity,
        relay,
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.relay = relay;
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
            return makeHeaders("not configured", "not configured");
        }

        const hmacKey = await this.symKey();

        return await signedHeaders(
            hmacKey
        )

    }

    
}