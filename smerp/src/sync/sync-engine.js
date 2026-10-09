import { PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { EnvelopeStream } from "./envelope-stream.js";
import { EventTypes } from "../event/event-bus.js";

export class SyncEngine {

    constructor({
        identity,
        transporter,
        storage,
        ingestor,
        logger,
        eventBus,
        pkh,
    }) {

        insist(identity, PrivateIdentity);
        insist(transporter);
        insist(storage);
        insist(ingestor);
        insist(logger);
        insist(eventBus);
        insist(pkh);

        this.identity = identity;
        this.transporter = transporter;
        this.logger = logger;
        this.storage = storage;
        this.ingestor = ingestor;
        this.eventBus = eventBus;
        this.pkh = pkh;
        this.concurrencyLimiter = new ConcurrencyLimiter(6);
    }

    async syncRelays(relays) {

        const enabled = relays.filter(
            relay => !relay.disabled
        );

        const settled = await Promise.allSettled(
            enabled.map(
                relay => this.syncRelay(relay)
            )
        );

        settled.forEach((x, i) => {

            if (x.status !== "rejected") {
                return;
            }

            this.logger.info("Sync Process rejection: ", x.reason);

            this.eventBus.publish({
                type: EventTypes.ERROR,
                error: x.reason,
                relayUrl: enabled[i].relayUrl,
            });
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

            await this.persist({
                relay,
                envelopeBytes
            })


        } while ( envelopeBytes && cnt < 50 );

        const [stored] = await this.storage.relaysGet({ relayUrl: relay.relayUrl });

        if (!stored) {
            return;
        }

        this.eventBus.publish({
            type: EventTypes.RELAY,
            relay,
            deleted: false,
        });

    }

    async persist({
        relay,
        envelopeBytes
    }) {

        // Do not resurrect a relay deleted while this sync was running.
        const [stored] = await this.storage.relaysGet({ relayUrl: relay.relayUrl });

        if (!stored) {
            return;
        }

        await this.storage.relaysPut(relay);

        if (envelopeBytes) {
            await this.ingestor.ingest(envelopeBytes);
        }

    }
}
