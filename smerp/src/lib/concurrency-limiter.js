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

        this.queue = [];
    }

    async run(task) {

        await this.acquire();

        try {

            return await task();

        } finally {

            this.release();
        }

    }

    async acquire() {
        if (this.active < this.limit) {

            this.active++;

            return;
        }

        await new Promise(resolve => {
            this.queue.push(resolve);
        });

    }

    release() {

        const next = this.queue.shift();

        if (next) {

            next();

            return;
        }

        this.active--;

    }

}