import { importPublicKey, deriveSharedSecret } from "../../../smep/src/crypto/x25519.js";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf.js";
import { hmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";
import { type } from "node:os";

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
        
        const relayPublicKey = await importPublicKey(this.relay.relayPkh);
        
        const sharedSecret = await deriveSharedSecret(
            this.identity.privateKey,
            relayPublicKey
        );

        this._symKey = await deriveHmacKey(
            sharedSecret
        );

        return this._symKey;

    }

    timestamp() {
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const timestampEncoded = encodeUtf8(timestamp);

        return {timestamp, timestampEncoded};
    }

    // Public api.

    async headers() {

        const {timestamp, timestampEncoded} = this.timestamp();

        const hmacKey = await this.symKey();

        const signature = await hmacSha256(
            hmacKey,
            timestampEncoded
        );

        return {
            "x-smerp-timestamp": timestamp,
            "x-smerp-signature": signature
        };

    }

}