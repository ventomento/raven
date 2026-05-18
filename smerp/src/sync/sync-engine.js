import { SmerpClient } from "../smerp-client.js";
import { insist } from "../../../smep/src/util/util.js";
import { RequestBuilder } from "../request/request-builder.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { ResponseHandler } from "./response-handler.js";

export class SyncEngine {

    constructor({
        smerpClient,
        pkh,
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;
        this.transporter = smerpClient.transporter;
        this.logger = smerpClient.logger;
        this.pkh = pkh;
        this.concurrencyLimiter = new ConcurrencyLimiter(6);
}

    async syncRelays(relays) {

        const settled = await Promise.allSettled(
            relays
            .filter(
                relay => !relay.disabled
            )
            .map(
                relay => this.syncRelay(factories.ResponseHandler(relay, this.smerpClient))
            )
        );

        settled
        .filter(x => x.status === "rejected")
        .forEach(x => {
            this.logger.info("Sync Process rejection: ", x.reason);
        });

    }

    async syncRelay(responseHandler) {

        let hasMore = null;
        let cnt = 0;

        do {  
            cnt++;
            hasMore = await this.concurrencyLimiter.run(
                () => this.nextEnvelope(responseHandler)
            );
        } while ( hasMore && cnt < 50 );

    }

    async nextEnvelope(responseHandler) {

        const response = await this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(responseHandler.relay, this.pkh),
            logger: this.logger
        });

        return await responseHandler.handle(response);
    }
    
}

const factories = {
    ResponseHandler(relay, smerpClient){
        return new ResponseHandler({
            relay,
            storage: smerpClient.storage,
            ingestor: smerpClient.ingestor,
            logger: smerpClient.logger
        })
    }
}
