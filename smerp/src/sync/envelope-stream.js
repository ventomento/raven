import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { TransportDefault } from "../transport/transport-default";
import { RequestBuilder } from "../request/request-builder.js";

const SMERP_HEADERS = {
    cursor: "x-smerp-cursor",
    signature: "x-smerp-signature",
    timestamp: "x-smerp-timestamp",
    unauthorized: "x-smerp-unauthorized"
}

export class EnvelopeStream {

    constructor({
        identity,
        relay,
        transporter = new TransportDefault(),
        logger,
        clock = {
            now: () => Date.now(),
        },
    }) {

        insist(identity, PrivateIdentity);
        
        this.identity = identity;
        this.relay = relay;
        this.relay.cursor = this.relay.cursor || 0;
        this.transporter = transporter;
        this.logger = logger;

        this.authHandler = new AuthHandler({
            identity: this.identity,
            relay,
            transporter: this.transporter
        });
    }


    /*
    * return: next envelope or null
    */
    async next() {

        const summary = this.doNext();

        return summary ? summary.envelope : null;

    }

    // private

    async doNext() {

        let summary = 
            await this.processResponse(
                await this.envelopesGet()
            );
        
        if (summary && summary.reauth)  {

            summary = 
                await this.processResponse(
                    await this.envelopesGet()
                );
            
        }

        return summary;

    }

    async envelopesGet() {

        return await this.transporter.transport({
            url: 
                RequestBuilder.urlEnvelopesGet(
                    responseHandler.relay, this.identity.publicKeyHex
                ),
            options:
                {
                    headers: {...await this.authHandler.getHeaders()}
                }, 
            logger: 
                this.logger
        });

    }

    processResponse(response) {

        let res;
        // res {envelope, reauth}

        switch (response.status) {

            case 200:
                // "envelope
                res = this.on200();

            case 204:
                // "exhausted"
                res = this.on204();

            case 401:
                // unauthorized
                res = this.on401();

            default:
                // unsupported
                res = this.onUnsupported();
        }

        return res;

    }

    on200(response) {

        const nextCursor = 
            this.cursorValidate(
                this.cursorExtract(response.headers)
            )

        if (nextCursor) {
            this.relayUpdateCursor(nextCursor);
            this.relaySuccess();

            return {
                envelope: response.body,
            }

        } 
        
        this.relayFailure();   
        
    }

    on204(response) {
        this.relaySuccess();
    }

    on401(response) {

        const authExpired = 
            response.headers.get(SMERP_HEADERS.unauthorized)?.toLowerCase() === "expired";

        if (authExpired) {

            this.relaySuccess();

            this.authHandler.clearSession();
            
            return {
                reauth : true
            }

        }

        this.relayFailure(); // Server is not implementing protocol correctly.       
    }

    onUnsupported(){
        this.relayFailure();
    }

    cursorExtract(headers){
        
        const headerCursor = headers.get(
            SMERP_HEADERS.cursor
        )

        return headerCursor ? Number(headerCursor) : -1;

    }

    cursorValidate(cursor) {
        
        if (cursor <= this.relay.cursor) {
            return null;
        } 
        else {
            return cursor;
        }

    }

    relayUpdateCursor(newCursor) {

        if (newCursor <= this.relay.cursor) {
            throw new Error("cursor regression");
        }

        this.relay.cursor = newCursor;
    }

    relaySuccess() {

        this.relay.lastSuccessAt =
            this.clock.now();

        this.relay.failureCount = 0;
    }

    relayFailure() {

        this.relay.failureCount =
            (this.relay.failureCount ?? 0) + 1;

        this.relay.lastFailureAt =
            this.clock.now();

        this.relay.disabled =
            this.relay.failureCount > 2;
    }

}

