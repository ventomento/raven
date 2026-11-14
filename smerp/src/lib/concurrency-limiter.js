/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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