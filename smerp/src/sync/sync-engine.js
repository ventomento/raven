import { SmerpClient } from "../smerp-client";
import { insist } from "../../../smep/src/util/util";
import { RequestBuilder } from "../request/request-builder";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";

export class SyncEngine {

    constructor({
        smerpClient,
        logger = console,
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;

        this.transporter =
            smerpClient.transporter;

        this.logger = logger;

        this.concurrencyLimiter =
            new ConcurrencyLimiter(6);
    }

    /**
     * Synchronize all relays concurrently,
     * bounded by the shared limiter.
     */
    async syncRelays() {

        const relays = await this.smerpClient.relaysGet();
        const pkh = await this.smerpClient.identity.exportPublicHex();

        return Promise.allSettled(
            relays.map(relay =>
                this.syncRelay(relay, pkh)
            )
        );

    }

    /**
     * Each relay behaves as a sequential stream.
     *
     * Guarantees:
     * - fetch ordering
     * - ingest before cursor advancement
     * - one in-flight record per relay
     */
    async syncRelay(relay, pkh) {
        if (relay.disabled){
            return;
        }

        let currentRelay = relay;

        try {

            for (let i=0; i<100; i++) {  //arbitrary max loops as opposed to while(true).

                const result = await this.concurrencyLimiter.run(
                    () => this.nextEnvelope(currentRelay, pkh)
                );

                if (result.done !== false) {
                    return;
                }

                currentRelay = result.relay;

            }
            this.logger.warn(
                "relay sync loop limit reached",
                { relay: currentRelay }
            );

        } catch (err) {

            this.logger.error(
                "relay sync failed",
                {
                    relay: currentRelay,
                    err,
                }
            );
            throw err;

        }

    }

    /**
     * Fetch exactly one envelope from relay stream.
     */
    async nextEnvelope(relay, pkh) {

        const {status, headers, body} = await this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(relay, pkh)
        });

        const cursor =  await this.nextCursor({status, headers}, relay);

        if (!cursor) {
            return {
                done: true,
            };
        }

        const ingested = await this.smerpClient.ingest(body);

        if (ingested) {
            return this.ingestSuccess(relay, cursor);
        } else {
            return this.ingestFailed(relay);
        }

    }
    
    async nextCursor({status, headers}, relay) {

        let cursor;

        if (status === 204) {
            this.logger.info(
                "relay exhausted",
                {
                    relay,
                    status,
                }
            );
            await this.smerpClient.relaysPut({
                    ...relay,
                    lastSuccessAt: Date.now(),
            });

            return cursor;

        }

        if (status !== 200) {
            this.logger.error(
                "relay transport failed",
                {
                    relay,
                    status,
                }
            );
            await this.smerpClient.relaysPut({
                    ...relay,
                    lastFailureAt: Date.now(),
                    failureCount: (relay.failureCount ?? 0) + 1
            });

            return cursor;
        }

        cursor = this.cursorFromHeaders(headers);

        if (!cursor) {
            await this.cursorInvalid(relay);
        }

        return cursor;
    }

    async cursorInvalid(relay){
        // Invalid cursor metadata.
        await this.smerpClient.relaysPut({
                ...relay,
                lastFailureAt: Date.now(),
                failureCount: (relay.failureCount ?? 0) + 1,
                disabled: true,
        });
        this.logger.warn(
            "relay disabled due to invalid next cursor (server doesn't implement protocol properly)",
            {
                relay,
            }
        );
    }

    async ingestSuccess(relay, cursor){
        const updatedRelay = await this.smerpClient.relaysPut({
            ...relay,
            lastSuccessAt: Date.now(),
            cursor,
    });
        
        return {
            done: false,
            relay: updatedRelay,
        };
    }

    ingestFailed(relay){
        this.logger.warn(
            "ingest rejected record",
            {
                relay,
                cursor: relay.cursor,
            }
        );

        return {
            done: true,
        };
    }

    cursorFromHeaders(headers) {
        try {
            const meta = headers.get("x-smerp-meta");
            if (!meta) {
                return null;
            }
            return JSON.parse(meta).id ?? null;
        } catch {
            return null;
        }
    }

}
