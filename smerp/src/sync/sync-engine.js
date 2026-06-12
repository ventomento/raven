import { PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { AuthHandler } from "../auth/auth-handler.js";
import { RequestBuilder } from "../request/request-builder.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { ResponseHandler } from "./response-handler.js";

export class SyncEngine {

    constructor({
        identity,
        transporter,
        storage,
        ingestor,
        logger,
        pkh,
        
    }) {

        insist(identity, PrivateIdentity);
        insist(transporter);
        insist(storage);
        insist(ingestor);
        insist(logger);
        insist(pkh);

        this.identity;
        this.transporter = transporter;
        this.logger = logger;
        this.storage = storage;
        this.ingestor = ingestor;
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
                relay => this.syncRelay(relay)
            )
        );

        settled
        .filter(x => x.status === "rejected")
        .forEach(x => {
            this.logger.info("Sync Process rejection: ", x.reason);
        });

    }

    async syncRelay(relay) {
        const handlers = this.getRelayHandlers(relay);
        // relay stream

        let hasMore = null;
        let cnt = 0;

        do {  
            cnt++;
            hasMore = await this.concurrencyLimiter.run(
                () => this.nextEnvelope(handlers)
            );
        } while ( hasMore && cnt < 50 );

    }

    async nextEnvelope(handlers) {

        const {responseHandler, authHandler} = handlers;

        const response = await this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(responseHandler.relay, this.pkh),
            options:
                {
                    headers: {...authHandler.getHeaders()}
                }, 
            logger: this.logger
        });

        return await responseHandler.handle(response);
    }

    getRelayHandlers(relay) {

        return {

            authHandler: 
                AuthHandler({
                    identity: this.identity,
                    relay,
                    transporter: this.transporter
                }),

            responseHandler:
                ResponseHandler({
                    relay,
                    logger: this.logger,
                    storage: this.storage,
                    ingestor: this.ingestor    

                })
        }

    }

}