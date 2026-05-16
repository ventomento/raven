import { SmerpClient } from "../smerp-client.js";
import { insist } from "../../../smep/src/util/util.js";
import { RequestBuilder } from "../request/request-builder.js";
import { LoggerDefault} from "../log/logger-default.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { ResponseHandler } from "./response-handler.js";

export class SyncEngine {

    constructor({
        smerpClient,
        logger = LoggerDefault,
        pkh
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;
        this.transporter = smerpClient.transporter;
        this.logger = logger;
        this.pkh = pkh;
        this.concurrencyLimiter = new ConcurrencyLimiter(6);
}

    async syncRelays(relays) {

        return await Promise.allSettled(
            relays.map(relay =>
                this.syncRelay(relay)
            )
        );

    }

    async syncRelay(relay) {

        if (relay.disabled){
            return;
        }

        const responseHandler = factories.ResponseHandler(relay, this.smerpClient);

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
