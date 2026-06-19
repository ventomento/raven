import { PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { EnvelopeStream } from "./envelope-stream.js";

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

        this.identity = identity;
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

        const envelopeStream = 
            new EnvelopeStream({
                identity: this.identity,
                relay,
                transporter: this.transporter,
                logger: this.logger
            })

        let envelopeBytes = null;
        let cnt = 0;

        do { 

            cnt++;

            envelopeBytes = await this.concurrencyLimiter.run(
                () => envelopeStream.next()
            );

            this.persist({
                relay,
                envelopeBytes
            })


        } while ( envelopeBytes && cnt < 50 );

    }

    async persist({
        relay,
        envelopeBytes
    }) {

        await this.storage.relaysPut(relay); 

        if (envelopeBytes) {
            await this.ingestor.ingest(envelopeBytes);
        }

    }
}
