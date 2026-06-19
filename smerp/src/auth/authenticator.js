import { importPublicKey, deriveSharedSecret } from "../../../smep/src/crypto/x25519.js";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf.js";
import { hmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { symHmacKey, makeHeaders, signedHeaders } from "./protocol.js";

// Authentication Claim: I own the private key at timestamp.

export class Authenticator {

    constructor({
        identity,
        relay,
    }) {
        this.identity = identity;
        this.relay = relay;
        this._symKey = null;

    }

    async symKey() {

        if (this._symKey){
            return this._symKey;
        }
        
        const publicIdentity = PublicIdentity.fromPublicHex(this.relay.relayPkh);

        this._symKey = await symHmacKey({
            PrivateIdentity : this.identity, 
            PublicIdentity : publicIdentity
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