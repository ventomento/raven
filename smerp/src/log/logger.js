import { RealClock } from "../lib/clock.js";

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
