import { SmerpClient } from "../smerp-client";
import { insist } from "../../../smep/src/util/util";
import { RequestBuilder } from "../request/request-builder";

export class SyncEngine {

    constructor({
        smerpClient,
        concurrency = 6,
        logger = console,
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;

        this.transporter =
            smerpClient.transporter;

        this.logger = logger;

        this.concurrencyLimiter =
            new ConcurrencyLimiter(
                concurrency
            );
    }

    /**
     * Synchronize all relays concurrently,
     * bounded by the shared limiter.
     */
    async syncRelays(relays, pkh) {

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

            while (!currentRelay.disabled) { 

                const result = await this.concurrencyLimiter.run(
                    () => this.fetchNext(currentRelay, pkh)
                );

                if (result.done) {
                    return;
                }

                currentRelay = result.relay;

            }

        } catch (err) {

            this.logger.error(
                "relay sync failed",
                {
                    relay: currentRelay,
                    err,
                }
            );

        }

    }

    /**
     * Fetch exactly one record from relay stream.
     */
    async fetchNext(relay, pkh) {

        const {status, headers, body} = await this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(relay, pkh)
        });

        // Relay exhausted.
        if (status === 204) {

            return {
                done: true,
            };
        }

        // Transport/server failure.
        if (status !== 200) {

            this.logger.error(
                "relay transport failed",
                {
                    relay,
                    status,
                }
            );

            return {
                done: true,
            };
        }

        const nextCursor =
            this.nextCursor(headers);

        // Invalid cursor metadata.
        if (!nextCursor) {

            const disabledRelay =
                await this.smerpClient.relaysPut({
                    ...relay,
                    disabled: true,
                });

            this.logger.warn(
                "relay disabled due to invalid next cursor",
                {
                    relay,
                }
            );

            return {
                done: true,
                relay: disabledRelay,
            };
        }

        // Cursor must not advance
        // until ingest confirmed.
        const ingested =
            await this.smerpClient.ingest(body);

        if (!ingested) {

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

        const updatedRelay =
            await this.smerpClient.relaysPut({
                ...relay,
                cursor: nextCursor,
            });

        return {
            done: false,
            relay: updatedRelay,
        };

    }

    nextCursor(headers) {

        try {

            return JSON.parse(
                headers.get("x-smerp-meta")
            ).id ?? null;

        } catch {

            return null;
        }

    }

}

/**
 * Fair FIFO async concurrency limiter.
 *
 * Guarantees:
 * - at most `limit` concurrent tasks
 * - FIFO wakeup ordering
 * - no recursive scheduling
 * - direct ownership transfer
 */
class ConcurrencyLimiter {

    constructor(limit) {

        if (
            !Number.isInteger(limit) ||
            limit <= 0
        ) {
            throw new Error(
                "Concurrency limit must be > 0"
            );
        }

        this.limit = limit;

        /**
         * Number of currently running tasks.
         */
        this.active = 0;

        /**
         * Queue of waiting continuations.
         * Queue is not for tasks! its only for resolve functions of promises that is awaited by tasks.
         */
        this.queue = [];
    }

    /**
     * Execute task within concurrency limit.
     */
    async run(task) {

        await this.acquire();

        try {

            return await task();

        } finally {

            this.release();
        }

    }

    /**
     * Acquire execution slot.
     */
    async acquire() {

        // Fast path.
        if (this.active < this.limit) {

            this.active++;

            return;
        }

        // Wait until ownership transferred.
        await new Promise(resolve => {
            this.queue.push(resolve);
        });

    }

    /**
     * Release execution slot.
     *
     * Important:
     * If waiters exist we transfer ownership
     * directly instead of decrementing active.
     */
    release() {

        const next =
            this.queue.shift();

        // Direct ownership transfer.
        if (next) {

            next();

            return;
        }

        // No waiters remaining.
        this.active--;

    }

}