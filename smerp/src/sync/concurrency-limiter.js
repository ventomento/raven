/**
 * Fair FIFO async concurrency limit executor. Put cap on concurrent executions.
 *
 * Guarantees:
 * - at most `limit` concurrent tasks
 * - FIFO wakeup ordering
 * - direct ownership transfer
 */
export class ConcurrencyLimiter {

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

        const next = this.queue.shift();

        // Direct ownership transfer.
        if (next) {

            next();

            return;
        }

        // No waiters remaining.
        this.active--;

    }

}