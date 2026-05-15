import { SmerpClient } from "../smerp-client";
import { insist } from "../../../smep/src/util/util";
import { RequestBuilder } from "../request/request-builder";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";

export class SyncEngine {

    constructor({
        smerpClient,
        logger = console,
        concurrencyLimiter,
        requestBuilder = RequestBuilder,
        now = () => Date.now(),
        maxRelayIterations = 100,
    }) {

        insist(smerpClient, SmerpClient);

        this.smerpClient =
            smerpClient;

        this.transporter =
            smerpClient.transporter;

        this.logger =
            logger;

        this.requestBuilder =
            requestBuilder;

        this.now =
            now;

        this.maxRelayIterations =
            maxRelayIterations;

        this.concurrencyLimiter =
            concurrencyLimiter ??
            new ConcurrencyLimiter(6);
    }

    /**
     * Synchronize all relays concurrently,
     * bounded by the shared limiter.
     */
    async syncRelays() {

        const relays =
            await this.smerpClient.relaysGet();

        const pkh =
            await this.smerpClient
                .identity
                .exportPublicHex();

        return Promise.allSettled(
            relays.map(relay =>
                this.syncRelay(relay, pkh)
            )
        );

    }

    /**
     * Each relay behaves as a sequential stream.
     */
    async syncRelay(relay, pkh) {

        if (relay.disabled) {
            return;
        }

        let currentRelay =
            relay;

        try {

            for (
                let i = 0;
                i < this.maxRelayIterations;
                i++
            ) {

                const result =
                    await this.concurrencyLimiter.run(
                        () =>
                            this.nextEnvelope(
                                currentRelay,
                                pkh
                            )
                    );

                if (result.done !== false) {
                    return;
                }

                currentRelay =
                    result.relay;

            }

            this.logger.warn(
                "relay sync loop limit reached",
                {
                    relay: currentRelay,
                    maxRelayIterations:
                        this.maxRelayIterations,
                }
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
     * Fetch exactly one envelope.
     */
    async nextEnvelope(relay, pkh) {

        const response =
            await this.fetchEnvelope(
                relay,
                pkh
            );

        const cursor =
            await this.nextCursor(
                response,
                relay
            );

        if (!cursor) {

            return {
                done: true,
            };

        }

        const ingested =
            await this.smerpClient.ingest(
                response.body
            );

        if (!ingested) {

            return this.ingestFailed(
                relay
            );

        }

        return this.ingestSuccess(
            relay,
            cursor
        );

    }

    /**
     * Isolated transport boundary.
     * Easy to mock in tests.
     */
    async fetchEnvelope(relay, pkh) {

        return this.transporter.transport({
            url:
                this.requestBuilder
                    .urlEnvelopesGet(
                        relay,
                        pkh
                    )
        });

    }

    /**
     * Determine next cursor state.
     */
    async nextCursor(
        { status, headers },
        relay
    ) {

        if (status === 204) {

            await this.markRelaySuccess(
                relay
            );

            this.logger.info(
                "relay exhausted",
                {
                    relay,
                    status,
                }
            );

            return null;

        }

        if (status !== 200) {

            await this.markRelayFailure(
                relay
            );

            this.logger.error(
                "relay transport failed",
                {
                    relay,
                    status,
                }
            );

            return null;

        }

        const cursor =
            this.cursorFromHeaders(
                headers
            );

        if (!cursor) {

            await this.cursorInvalid(
                relay
            );

            return null;

        }

        return cursor;

    }

    async ingestSuccess(
        relay,
        cursor
    ) {

        const updatedRelay =
            await this.smerpClient.relaysPut({
                ...relay,
                cursor,
                lastSuccessAt:
                    this.now(),
            });

        return {
            done: false,
            relay: updatedRelay,
        };

    }

    ingestFailed(relay) {

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

    async cursorInvalid(relay) {

        await this.smerpClient.relaysPut({
            ...relay,
            disabled: true,
            lastFailureAt:
                this.now(),
            failureCount:
                (relay.failureCount ?? 0) + 1,
        });

        this.logger.warn(
            "relay disabled due to invalid next cursor",
            {
                relay,
            }
        );

    }

    async markRelaySuccess(relay) {

        await this.smerpClient.relaysPut({
            ...relay,
            lastSuccessAt:
                this.now(),
        });

    }

    async markRelayFailure(relay) {

        await this.smerpClient.relaysPut({
            ...relay,
            lastFailureAt:
                this.now(),
            failureCount:
                (relay.failureCount ?? 0) + 1,
        });

    }

    cursorFromHeaders(headers) {

        try {

            const meta =
                headers.get(
                    "x-smerp-meta"
                );

            if (!meta) {
                return null;
            }

            return JSON.parse(meta)
                .id ?? null;

        } catch {

            return null;

        }

    }

}