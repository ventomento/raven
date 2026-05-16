import { SmerpClient } from "../smerp-client";
import { insist } from "../../../smep/src/util/util";
import { RequestBuilder } from "../request/request-builder";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { ResponseHandler } from "./response-handler.js";

export class SyncEngine {

    constructor({
        smerpClient,
        logger = console,
        pkh
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;
        this.transporter = smerpClient.transporter;
        this.logger = logger;
        this.pkh = pkh;
        this.concurrencyLimiter = ConcurrencyLimiter(6);
}

    async syncRelays(relays) {

        return Promise.allSettled(
            relays.map(relay =>
                this.syncRelay(relay)
            )
        );

    }

    async syncRelay(relay) {

        if (relay.disabled){
            return;
        }

        const responseHandler = ResponseHandler(this.smerpClient, relay);
        let hasMore = null;

        do {  
            hasMore = await this.concurrencyLimiter.run(
                () => this.nextEnvelope(responseHandler)
            );
        } while ( hasMore );

    }

    async nextEnvelope(responseHandler) {

        const response = await this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(responseHandler.relay, this.pkh)
        });

        return await responseHandler.handle(response);
    }
    
}
