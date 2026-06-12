import { TransportDefault } from "../transport/transport-default";
import { RequestBuilder } from "../request/request-builder";

import { authSessionKey, authSign } from "../../../smep/src/index.js";

export class AuthHandler {

    constructor({
        identity,
        relay,
        transporter = new TransportDefault()
    }) {

        this.identity = identity;
        this.relay = relay;
        this.transporter = transporter;

        this.endpointUrl =
            RequestBuilder.urlIntentsPost(relay);

        this.sessionKey = null;

    }

    async getHeaders(expired=false) {

        if (expired){
            this.clearSession();
        }

        if (!this.sessionKey) {
            await this.createSession();
        }

        const {signature, timestamp} = await authSign(
            this.sessionKey,
        );

        return {
            "x-smerp-auth-timestamp": timestamp,
            "x-smerp-auth-signature": signature
        };

    }

    async createSession() {

        const body = {
            pkh: this.identity.publicKeyHex
        };

        const response = await this.transporter.transport(
            this.endpointUrl,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            }
        );

        if (response.status !== 200) {
            throw new Error(
                `Intent request failed with status ${response.status}`
            );
        }

        const { ephemeral_pkh } = response.body;

        this.sessionKey = await authSessionKey(
            this.identity,
            ephemeral_pkh
        );

    }

    clearSession() {
        this.sessionKey = null;
    }

}