// Shared fixtures: real smep envelopes, the mock relay, and small doubles
// for the sync modules.

import {
    PrivateIdentity,
    PublicIdentity,
    encrypt,
    envelopeHash,
} from "../../../smep/src/index.js";
import { SmerpServer } from "../../src/server/index.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";

export const identity = () => PrivateIdentity.generate();

/**
 * A real envelope from sender to recipient (PrivateIdentity or
 * PublicIdentity). Returns { bytes, buffer, hash }: bytes as encrypt gives
 * them, buffer as a frame from decodeBatch (its own ArrayBuffer), hash the
 * envelope hash (hex sha256, smep_rfc section 6).
 */
export async function envelopeFor(sender, recipient, plaintext = "hi", options = {}) {

    const buffer = await encrypt({
        sender,
        recipient: new PublicIdentity(recipient.publicKey),
        plaintext,
        ...options,
    });

    return {
        bytes: new Uint8Array(buffer),
        buffer,
        hash: await envelopeHash(buffer),
    };
}

// A frame that is not an envelope.
export const garbageFrame = () => new Uint8Array([1, 2, 3, 4]).buffer;

/**
 * The mock relay on an ephemeral port, closed after the test. Returns
 * { server, relay } with relay a record for relaysPut.
 */
export async function startRelay(t, options, relayType = "archive") {

    const server = new SmerpServer(options);
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return {
        server,
        relay: {
            relayUrl: `http://127.0.0.1:${server.server.address().port}`,
            relayType,
        },
    };
}

// A promise with its resolve and reject outside.
export function deferred() {

    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

/**
 * A fake Scheduler session. Each step() call returns a new deferred,
 * logged in `steps` (in call order) and `log` (by name), and is settled
 * by the test. notBeforeAt is what notBefore() returns.
 */
export class FakeSession {

    constructor(name, { notBeforeAt = 0 } = {}) {
        this.name = name;
        this.notBeforeAt = notBeforeAt;
        this.steps = [];
    }

    notBefore() {
        return this.notBeforeAt;
    }

    step() {
        const step = deferred();
        this.steps.push(step);
        return step.promise;
    }

    // The deferred of the step in flight.
    get current() {
        return this.steps.at(-1);
    }
}

/**
 * A fake Scheduler session that answers every step from a script at once:
 * script is an array of booleans (more?) or Errors (reject), and once it
 * runs out, steps resolve false. Calls are appended to `log`.
 */
export class ScriptedSession {

    constructor(name, script = [], log = []) {
        this.name = name;
        this.script = [...script];
        this.log = log;
        this.notBeforeAt = 0;
    }

    notBefore() {
        return this.notBeforeAt;
    }

    async step() {

        this.log.push(this.name);

        const next = this.script.shift() ?? false;

        if (next instanceof Error) {
            throw next;
        }

        return next;
    }
}

/**
 * StorageMemory whose calls yield to the event loop first, so concurrent
 * callers interleave between reading and writing unless something
 * serializes them. failOn: { method: Error } throws from that method.
 */
export class SlowStorage extends StorageMemory {

    constructor({ failOn = {} } = {}) {
        super();
        this.failOn = failOn;
    }
}

for (const method of [
    "envelopesGet", "envelopesPut",
    "conversationsGet", "conversationsPut",
    "relaysGet", "relaysPut", "relaysDelete",
]) {

    SlowStorage.prototype[method] = async function (...args) {

        await new Promise(resolve => setImmediate(resolve));

        const failure = this.failOn[method];

        if (failure) {
            throw failure;
        }

        return StorageMemory.prototype[method].apply(this, args);
    };
}

// A logger that records what it is told.
// The logger contract (log/logger.js). Entries are [level, message, fields];
// a child records into the same entries with its fields merged.
export class RecordingLogger {

    constructor({ entries = [], fields = {} } = {}) {
        this.enabled = true;
        this.entries = entries;
        this.fields = fields;
    }

    debug(message, fields) { this.record("debug", message, fields); }
    info(message, fields) { this.record("info", message, fields); }
    warn(message, fields) { this.record("warn", message, fields); }
    error(message, fields) { this.record("error", message, fields); }

    child(fields) {
        return new RecordingLogger({ entries: this.entries, fields: { ...this.fields, ...fields } });
    }

    record(level, message, fields) {
        this.entries.push([level, message, { ...this.fields, ...fields }]);
    }

    warnings() {
        return this.entries.filter(([level]) => level === "warn").map(([, message]) => message);
    }
}
