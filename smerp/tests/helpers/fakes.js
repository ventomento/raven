// Test doubles for sync: a virtual clock and a scriptable relay transport.

/**
 * Clock with virtual time. sleep() never waits for real: once nothing
 * else is runnable, the earliest sleeper wakes and time jumps to it.
 * advance(ms) moves time forward by hand.
 */
export class VirtualClock {

    constructor(start = 1_000_000) {
        this.t = start;
        this.timers = [];
        this.scheduled = false;
    }

    now = () => this.t;

    sleep = (ms) => new Promise(resolve => {
        this.timers.push({ at: this.t + ms, resolve });
        this.#schedule();
    });

    advance(ms) {
        this.t += ms;
    }

    #schedule() {

        if (this.scheduled) {
            return;
        }

        this.scheduled = true;

        setImmediate(() => {

            this.scheduled = false;
            this.timers.sort((a, b) => a.at - b.at);

            const next = this.timers.shift();

            if (!next) {
                return;
            }

            this.t = Math.max(this.t, next.at);
            next.resolve();

            if (this.timers.length) {
                this.#schedule();
            }
        });
    }
}

/**
 * Transport for any number of fake relays, addressed by origin. Serves
 * GET /envelopes like the mock relay (one record per request, cursor =
 * record id) and accepts POSTs. Every request is logged in `requests`.
 *
 * `hook(request)` may return a response to override the default one.
 */
export class FakeRelays {

    constructor(clock) {
        this.clock = clock;
        this.records = new Map(); // relayUrl -> [{ id, body }]
        this.requests = [];
        this.hook = null;
    }

    add(relayUrl, body) {

        const list = this.records.get(relayUrl) ?? [];
        list.push({ id: list.length + 1, body });
        this.records.set(relayUrl, list);
    }

    transport = async ({ url, options = {} }) => {

        const parsed = new URL(url);

        const request = {
            relayUrl: parsed.origin,
            method: options.method ?? "GET",
            cursor: Number(parsed.searchParams.get("cursor")),
            at: this.clock.now(),
        };

        this.requests.push(request);

        const override = await this.hook?.(request);

        if (override) {
            return { headers: {}, body: "", ...override };
        }

        if (request.method === "POST") {
            return { status: 200, headers: {}, body: "" };
        }

        const next = (this.records.get(request.relayUrl) ?? [])
            .find(record => record.id > request.cursor);

        if (!next) {
            return { status: 204, headers: {}, body: "" };
        }

        return {
            status: 200,
            headers: { "x-smerp-cursor": String(next.id) },
            body: next.body,
        };
    };

    requestsTo(relayUrl) {
        return this.requests.filter(r => r.relayUrl === relayUrl);
    }
}

// Lets queued event-bus microtasks run.
export const tick = () => new Promise(resolve => setImmediate(resolve));
