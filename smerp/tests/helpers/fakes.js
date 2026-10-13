// Test doubles for sync: a virtual clock and a scriptable relay transport.

import { encodeBatch, MAX_BATCH_BYTES } from "../../src/protocol/index.js";

/**
 * Clock with virtual time.
 *
 * sleep() never waits for real: once nothing else is runnable, the
 * earliest sleeper wakes and time jumps to it.
 *
 * timer() callbacks only fire when the test moves time: advance(ms)
 * fires every timer due by then, and drive(promise) jumps from timer to
 * timer until the promise settles. So a pool's background timers (backoff,
 * 429 pauses) never move time behind the test's back.
 */
export class VirtualClock {

    constructor(start = 1_000_000) {
        this.t = start;
        this.timers = [];   // sleepers, woken automatically
        this.alarms = [];   // timer() callbacks, fired by advance/drive
        this.scheduled = false;
    }

    now = () => this.t;

    sleep = (ms) => new Promise(resolve => {
        this.timers.push({ at: this.t + ms, resolve });
        this.#schedule();
    });

    timer = (ms, fn) => {

        const alarm = { at: this.t + ms, fn };

        this.alarms.push(alarm);

        return () => {
            this.alarms = this.alarms.filter(a => a !== alarm);
        };
    };

    advance(ms) {
        this.t += ms;
        this.#fireDue();
    }

    /**
     * Let real async work run, and whenever it has gone quiet jump to the
     * next timer, until promise settles. Returns promise.
     */
    async drive(promise, { maxMs = 24 * 60 * 60 * 1000 } = {}) {

        let settled = false;
        promise.then(() => { settled = true; }, () => { settled = true; });

        const end = this.t + maxMs;

        for (let quiet = 0; quiet < 200; quiet++) {

            for (let i = 0; i < 20 && !settled; i++) {
                await tick();
            }

            if (settled) {
                return promise;
            }

            this.alarms.sort((a, b) => a.at - b.at);

            const next = this.alarms[0];

            if (next && next.at <= end) {
                this.t = Math.max(this.t, next.at);
                this.#fireDue();
                quiet = 0;
            }
        }

        throw new Error("VirtualClock.drive: promise did not settle");
    }

    #fireDue() {

        for (;;) {

            this.alarms.sort((a, b) => a.at - b.at);

            if (!(this.alarms[0]?.at <= this.t)) {
                return;
            }

            this.alarms.shift().fn();
        }
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
 * GET /envelopes like the mock relay (a batch of the records after the
 * cursor, at most `batchSize` of them; cursor = last record id) and
 * accepts POSTs. Every request is logged in `requests`.
 *
 * `hook(request)` may return a response to override the default one.
 * `setRelayPkh(relayUrl, pkh)` makes that relay announce its key as
 * x-smerp-relay-pkh on every response, hooked ones included (unless the
 * hook sets the header itself).
 */
export class FakeRelays {

    constructor(clock) {
        this.clock = clock;
        this.records = new Map(); // relayUrl -> [{ id, body }]
        this.relayPkhs = new Map(); // relayUrl -> pkh
        this.requests = [];
        this.hook = null;
        this.batchSize = Infinity;
    }

    add(relayUrl, body) {

        const list = this.records.get(relayUrl) ?? [];
        list.push({ id: list.length + 1, body });
        this.records.set(relayUrl, list);
    }

    setRelayPkh(relayUrl, pkh) {
        this.relayPkhs.set(relayUrl, pkh);
    }

    transport = async (args) => {

        const response = await this.respond(args);
        const relayPkh = this.relayPkhs.get(new URL(args.url).origin);

        if (relayPkh) {
            response.headers = { "x-smerp-relay-pkh": relayPkh, ...response.headers };
        }

        return response;
    };

    async respond({ url, options = {} }) {

        const parsed = new URL(url);

        const request = {
            relayUrl: parsed.origin,
            method: options.method ?? "GET",
            cursor: Number(parsed.searchParams.get("cursor")),
            signed: "x-smerp-signature" in (options.headers ?? {}),
            authorization: options.headers?.authorization,
            headers: options.headers ?? {},
            body: options.body,
            url,
            at: this.clock.now(),
        };

        this.requests.push(request);

        const override = await this.hook?.(request);

        if (override) {
            return { headers: {}, body: new Uint8Array(0), ...override };
        }

        if (request.method === "POST") {
            return { status: 200, headers: {}, body: new Uint8Array(0) };
        }

        const batch = [];
        let size = 0;

        for (const record of this.records.get(request.relayUrl) ?? []) {

            if (record.id <= request.cursor) {
                continue;
            }

            if (
                batch.length === this.batchSize ||
                (batch.length > 0 && size + record.body.byteLength > MAX_BATCH_BYTES)
            ) {
                break;
            }

            batch.push(record);
            size += record.body.byteLength;
        }

        if (batch.length === 0) {
            return { status: 204, headers: {}, body: new Uint8Array(0) };
        }

        return {
            status: 200,
            headers: { "x-smerp-cursor": String(batch[batch.length - 1].id) },
            body: encodeBatch(batch.map(record => record.body)),
        };
    }

    requestsTo(relayUrl) {
        return this.requests.filter(r => r.relayUrl === relayUrl);
    }
}

// Lets queued event-bus microtasks run.
export const tick = () => new Promise(resolve => setImmediate(resolve));
