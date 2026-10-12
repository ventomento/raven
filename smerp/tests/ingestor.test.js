import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../smep/src/index.js";
import { Ingestor, IngestOutcome } from "../src/inbox/ingestor.js";
import { EnvelopeOpener } from "../src/inbox/envelope-opener.js";
import { MessageStore } from "../src/state/message-store.js";
import { StorageMemory } from "../src/storage/storage-memory.js";
import { EventBus, EventTypes } from "../src/event/event-bus.js";
import { LightLog } from "../src/log/light-log.js";

// Every operation resolves on a later macrotask, like IndexedDB request
// callbacks, so concurrent ingests can interleave between steps.
class StorageAsync extends StorageMemory {}

for (const method of [
    "envelopesGet", "envelopesPut",
    "conversationsGet", "conversationsPut",
]) {
    StorageAsync.prototype[method] = async function (...args) {
        await new Promise(r => setTimeout(r, 0));
        return StorageMemory.prototype[method].apply(this, args);
    };
}

async function setup({ clock } = {}) {

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();
    const eventBus = new EventBus();
    const storage = new StorageAsync();
    const logger = new LightLog();

    const ingestor = new Ingestor({
        opener: new EnvelopeOpener({ identity: bob, publicKeyHex: bob.publicKeyHex }),
        store: new MessageStore({ storage, eventBus, logger, clock }),
        eventBus,
        logger,
    });

    const seal = (plaintext) => encrypt({
        sender: alice,
        recipient: new PublicIdentity(bob.publicKey),
        plaintext,
    });

    const events = [];
    for (const type of Object.values(EventTypes)) {
        eventBus.subscribe(type, (event) => events.push(event));
    }

    return { alice, bob, eventBus, storage, ingestor, seal, events };
}

// The same envelope fetched from two relays at once, as parallel relay
// sessions do. Fails intermittently without MessageStore's writeLock.
test("concurrent ingest of the same envelope stores and counts it once", async () => {

    const { alice, storage, ingestor, seal, events } = await setup();
    const bytes = await seal("hi");

    const results = await Promise.all([
        ingestor.ingest(bytes),
        ingestor.ingest(bytes),
    ]);
    await new Promise(r => setTimeout(r, 0));

    assert.deepEqual(
        results.map(r => r.outcome).sort(),
        [IngestOutcome.DUPLICATE, IngestOutcome.STORED]
    );
    assert.equal(events.filter(e => e.type === EventTypes.ENVELOPE).length, 1);

    const [conversation] = await storage.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});

test("malformed and foreign envelopes are rejected, not thrown", async () => {

    const { ingestor, storage, seal } = await setup();

    // not even an envelope
    const garbage = await ingestor.ingest(new Uint8Array([1, 2, 3]).buffer);
    assert.equal(garbage.outcome, IngestOutcome.REJECTED);
    assert.equal(garbage.uuid, null);

    // well-formed, but addressed to someone else
    const carol = await PrivateIdentity.generate();
    const dave = await PrivateIdentity.generate();
    const foreign = await encrypt({
        sender: carol,
        recipient: new PublicIdentity(dave.publicKey),
        plaintext: "not for bob",
    });
    const result = await ingestor.ingest(foreign);
    assert.equal(result.outcome, IngestOutcome.REJECTED);
    assert.match(result.uuid, /^[0-9a-f]{32}$/);

    // tampered ciphertext, otherwise addressed to bob
    const tampered = new Uint8Array(await seal("hi"));
    tampered[tampered.length - 1] ^= 1;
    assert.equal(
        (await ingestor.ingest(tampered.buffer)).outcome,
        IngestOutcome.REJECTED
    );

    assert.deepEqual(await storage.envelopesGet(), []);
});

test("a batch skips bad frames, keeps order and reports rejections with their source", async () => {

    const { ingestor, storage, seal, events } = await setup();

    const counts = await ingestor.ingestBatch(
        [await seal("one"), new Uint8Array([1, 2, 3]).buffer, await seal("two")],
        { relayUrl: "http://relay.test", cursor: 7 }
    );
    await new Promise(r => setTimeout(r, 0));

    assert.deepEqual(counts, { stored: 2, duplicate: 0, rejected: 1 });

    const stored = await storage.envelopesGet();
    const byReceived = stored.sort((a, b) => a.receivedAt - b.receivedAt);
    assert.deepEqual(byReceived.map(e => e.plaintext), ["one", "two"]);

    const rejected = events.filter(e => e.type === EventTypes.REJECTED);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].relayUrl, "http://relay.test");
    assert.equal(rejected[0].cursor, 7);
    assert.equal(rejected[0].uuid, null);
});

test("storage failures throw, so the caller retries", async () => {

    const { ingestor, storage, seal } = await setup();
    storage.envelopesPut = async () => { throw new Error("QuotaExceededError"); };

    await assert.rejects(ingestor.ingest(await seal("hi")), /QuotaExceededError/);
    await assert.rejects(ingestor.ingestBatch([await seal("hi")]), /QuotaExceededError/);
});

test("stored times are milliseconds", async () => {

    const { ingestor, seal } = await setup();
    const before = Date.now();

    const { envelope } = await ingestor.ingest(await seal("hi"));

    // wire timestamp is whole seconds, so allow up to 1s below
    assert.equal(envelope.timestamp, undefined);
    assert.equal(envelope.sentAt % 1000, 0);
    assert.ok(envelope.sentAt > before - 1000 && envelope.sentAt <= Date.now());
    assert.ok(envelope.receivedAt >= before && envelope.receivedAt <= Date.now());
});

test("receivedAt is strictly increasing within a millisecond", async () => {

    const frozen = { now: () => 5000, sleep: async () => {}, timer: () => () => {} };
    const { ingestor, seal } = await setup({ clock: frozen });

    const received = [];
    for (const text of ["one", "two", "three"]) {
        received.push((await ingestor.ingest(await seal(text))).envelope.receivedAt);
    }

    assert.deepEqual(received, [5000, 5001, 5002]);
});

test("own sent envelopes are outbound, read, and keyed by the recipient", async () => {

    const { bob, alice, ingestor } = await setup();

    const sent = await encrypt({
        sender: bob,
        recipient: new PublicIdentity(alice.publicKey),
        plaintext: "from bob",
    });

    const { envelope } = await ingestor.ingest(sent);

    assert.equal(envelope.direction, "outbound");
    assert.equal(envelope.read, true);
    assert.equal(envelope.publicKeyHex, alice.publicKeyHex);
});
