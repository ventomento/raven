// src/log/logger.js

import { RealClock } from "../lib/clock.js";

/**
 * Developer logger: off (silent) by default, on with SmerpClient's
 * debug flag. While off every call returns after one boolean check.
 * While on, each line goes to the sink method of the same level
 * (console by default, so devtools' level filter works):
 *
 *   [smerp] 12:03:01.390 batch { relayUrl: "https://…", from: 0, to: 812, frames: 14 }
 *
 * Contract (any object with these members can be injected as a logger):
 *   debug | info | warn | error(message, fields?)
 *       message: a constant lowercase phrase; fields: a plain object of
 *       cheap values (no encoding or serialization at the call site)
 *   child(fields)  a logger that adds fields to every line
 *   enabled        false: callers may skip building expensive fields
 *
 * Never log secrets or content: no plaintext, private keys, relay
 * tokens, signatures or HMAC keys. Hashes, relay URLs, public keys,
 * counts, statuses and cursors are fine. Relay-supplied strings are
 * untrusted: put them in fields, never in the message.
 */
export class Logger {

    constructor({
        enabled = false,
        sink = console,
        clock = RealClock,
        prefix = "[smerp]",
        fields = {},
    } = {}) {

        this.enabled = enabled;
        this.sink = sink;
        this.clock = clock;
        this.prefix = prefix;
        this.fields = fields;
    }

    debug(message, fields) {
        if (!this.enabled) return;
        this.write("debug", message, fields);
    }

    info(message, fields) {
        if (!this.enabled) return;
        this.write("info", message, fields);
    }

    warn(message, fields) {
        if (!this.enabled) return;
        this.write("warn", message, fields);
    }

    error(message, fields) {
        if (!this.enabled) return;
        this.write("error", message, fields);
    }

    child(fields) {
        return new Logger({
            enabled: this.enabled,
            sink: this.sink,
            clock: this.clock,
            prefix: this.prefix,
            fields: { ...this.fields, ...fields },
        });
    }

    write(level, message, fields) {

        // UTC HH:MM:SS.mmm
        const time = new Date(this.clock.now()).toISOString().slice(11, 23);
        const line = `${this.prefix} ${time} ${message}`;
        const merged = fields ? { ...this.fields, ...fields } : this.fields;

        if (Object.keys(merged).length === 0) {
            this.sink[level](line);
        }
        else {
            this.sink[level](line, merged);
        }
    }
}
