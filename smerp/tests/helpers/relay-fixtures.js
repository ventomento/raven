import {
    PrivateIdentity,
    PublicIdentity,
    encrypt,
    envelopeHash,
} from "../../../smep/src/index.js";
import { SmerpServer } from "../../src/server/index.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";

export const identity = () => PrivateIdentity.generate();

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

export const garbageFrame = () => new Uint8Array([1, 2, 3, 4]).buffer;

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

export function deferred() {

    let resolve;
    let reject;

    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

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

    get current() {
        return this.steps.at(-1);
    }
}

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
