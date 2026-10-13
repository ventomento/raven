import test from "node:test";
import assert from "node:assert/strict";

import { ContentTypes, envelopeHash } from "../../../smep/src/index.js";
import { Ingestor } from "../../src/ingest/ingestor.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";
import { VirtualClock } from "../helpers/fakes.js";
import {
    identity,
    envelopeFor,
    garbageFrame,
    SlowStorage,
    RecordingLogger,
} from "../helpers/relay-fixtures.js";

// Ingestion of real smep envelopes as bob.

const RELAY_URL = "http://relay.test";

async function setup({ storage = new StorageMemory() } = {}) {

    const clock = new VirtualClock();
    const [bob, alice, carol] = await Promise.all([identity(), identity(), identity()]);

    const events = [];

    const ingestor = new Ingestor({
        identity: bob,
        storage,
        logger: new RecordingLogger(),
        clock,
        onEnvelope: envelope => events.push({ type: "envelope", envelope }),
        onConversation: (conversation, created) => events.push({ type: "conversation", conversation, created }),
        onRejected: rejection => events.push({ type: "rejected", ...rejection }),
    });

    const of = (type) => events.filter(e => e.type === type);

    return { clock, bob, alice, carol, storage, ingestor, events, of };
}

test("an inbound envelope is stored, its conversation created, envelope announced first", async () => {

    const { clock, bob, alice, storage, ingestor, events } = await setup();

    const before = Math.floor(Date.now() / 1000) * 1000;
    const sent = await envelopeFor(alice, bob, "hello bob");
    const after = Date.now();

    await ingestor.ingest([sent.buffer], RELAY_URL);

    const [stored] = await storage.envelopesGet({ hash: sent.hash });

    assert.ok(stored.sentAt >= before && stored.sentAt <= after);
    assert.equal(stored.sentAt % 1000, 0, "whole wire seconds as ms");

    assert.deepEqual(stored, {
        hash: sent.hash,
        contentType: ContentTypes.TEXT_UTF8,
        plaintext: "hello bob",
        senderPublicKeyHex: alice.publicKeyHex,
        recipientPublicKeyHex: bob.publicKeyHex,
        publicKeyHex: alice.publicKeyHex,
        direction: "inbound",
        sentAt: stored.sentAt,
        receivedAt: clock.now(),
    });

    const conversation = { publicKeyHex: alice.publicKeyHex, unreadCount: 1, lastMessageAt: stored.sentAt };

    assert.deepEqual(await storage.conversationsGet(), [conversation]);
    assert.deepEqual(events, [
        { type: "envelope", envelope: stored },
        { type: "conversation", conversation, created: true },
    ]);
});

test("bytes keep their content type and stay bytes", async () => {

    const { bob, alice, storage, ingestor } = await setup();
    const plaintext = new Uint8Array([0, 1, 255]);

    const sent = await envelopeFor(alice, bob, plaintext, { contentType: ContentTypes.FILE });
    await ingestor.ingest([sent.buffer]);

    const [stored] = await storage.envelopesGet({ hash: sent.hash });
    assert.equal(stored.contentType, ContentTypes.FILE);
    assert.deepEqual(stored.plaintext, plaintext);
});

test("our own envelope is outbound, filed under the recipient, never unread", async () => {

    const { bob, alice, storage, ingestor, of } = await setup();

    const sent = await envelopeFor(bob, alice, "hi alice");
    await ingestor.ingest([sent.buffer]);

    const [stored] = await storage.envelopesGet({ hash: sent.hash });
    assert.equal(stored.direction, "outbound");
    assert.equal(stored.publicKeyHex, alice.publicKeyHex);
    assert.equal(stored.plaintext, "hi alice");

    const [{ conversation, created }] = of("conversation");
    assert.equal(created, true);
    assert.equal(conversation.publicKeyHex, alice.publicKeyHex);
    assert.equal(conversation.unreadCount, 0);
});

test("unread counts add up and the conversation is announced as updated", async () => {

    const { bob, alice, ingestor, of } = await setup();

    await ingestor.ingest([(await envelopeFor(alice, bob, "1")).buffer]);
    await ingestor.ingest([
        (await envelopeFor(alice, bob, "2")).buffer,
        (await envelopeFor(bob, alice, "mine")).buffer,
    ]);

    assert.deepEqual(
        of("conversation").map(e => [e.conversation.unreadCount, e.created]),
        [[1, true], [2, false], [2, false]]
    );
});

test("lastMessageAt only moves forward and other conversation fields are kept", async () => {

    const { bob, alice, storage, ingestor } = await setup();
    const future = Date.now() + 10 ** 9;

    await storage.conversationsPut({ publicKeyHex: alice.publicKeyHex, unreadCount: 0, lastMessageAt: future, pinned: true });

    await ingestor.ingest([(await envelopeFor(alice, bob)).buffer]);

    const [conversation] = await storage.conversationsGet();
    assert.equal(conversation.lastMessageAt, future);
    assert.equal(conversation.pinned, true);
});

test("receivedAt is strictly increasing while the clock stands still", async () => {

    const { clock, bob, alice, storage, ingestor } = await setup();

    const frames = [];
    for (let i = 0; i < 3; i++) {
        frames.push((await envelopeFor(alice, bob, `m${i}`)).buffer);
    }

    await ingestor.ingest(frames);

    const now = clock.now();
    const received = (await storage.envelopesGet()).map(e => e.receivedAt).sort();
    assert.deepEqual(received, [now, now + 1, now + 2]);

    clock.advance(1000);
    await ingestor.ingest([(await envelopeFor(alice, bob, "later")).buffer]);

    const [latest] = await storage.envelopesGet({ limit: 1 });
    assert.equal(latest.receivedAt, now + 1000);
});

test("an envelope seen again, in the same batch or a later one, is skipped silently", async () => {

    const { bob, alice, storage, ingestor, of } = await setup();
    const sent = await envelopeFor(alice, bob);

    await ingestor.ingest([sent.buffer, sent.buffer]);
    await ingestor.ingest([sent.buffer]);

    assert.equal((await storage.envelopesGet()).length, 1);
    assert.equal(of("envelope").length, 1);
    assert.equal(of("conversation").length, 1);
    assert.equal((await storage.conversationsGet())[0].unreadCount, 1);
});

test("dedup comes before decryption", async () => {

    const { bob, alice, carol, storage, ingestor, events } = await setup();

    // Bob cannot decrypt this, but its hash is already stored.
    const notForBob = await envelopeFor(alice, carol);
    await storage.envelopesPut({ hash: notForBob.hash });

    await ingestor.ingest([notForBob.buffer]);

    assert.deepEqual(events, []);
});

test("a squatter's envelope copying a header cannot get the real one skipped", async () => {

    const { bob, alice, ingestor, storage, of } = await setup();

    // A squatter can copy every header byte, but not the bytes as a whole,
    // so its envelope has a different hash and cannot block the real one.
    const real = await envelopeFor(alice, bob, "the real one");

    const forged = new Uint8Array(real.bytes);
    forged[forged.length - 1] ^= 0xff;   // same header, broken tag

    await ingestor.ingest([forged.buffer, real.buffer]);

    assert.equal(of("rejected").length, 1);
    assert.deepEqual((await storage.envelopesGet()).map(e => e.hash), [real.hash]);
    assert.equal((await storage.envelopesGet({ hash: real.hash }))[0].plaintext, "the real one");
});

test("unreadable and undecryptable envelopes are rejected; the batch goes on", async () => {

    const { bob, alice, carol, storage, ingestor, of } = await setup();

    const notForBob = await envelopeFor(alice, carol);
    const good = await envelopeFor(alice, bob);

    const garbage = garbageFrame();

    await ingestor.ingest([garbage, notForBob.buffer, good.buffer], RELAY_URL);

    const rejected = of("rejected");
    assert.equal(rejected.length, 2);

    assert.equal(rejected[0].hash, await envelopeHash(garbage));
    assert.equal(rejected[0].relayUrl, RELAY_URL);
    assert.equal(typeof rejected[0].reason, "string");

    assert.equal(rejected[1].hash, notForBob.hash);
    assert.equal(rejected[1].relayUrl, RELAY_URL);

    assert.deepEqual((await storage.envelopesGet()).map(e => e.hash), [good.hash]);
});

test("a storage error rejects the ingest, and later ingests still run", async () => {

    const fault = new Error("disk full");
    const storage = new SlowStorage({ failOn: { envelopesPut: fault } });
    const { bob, alice, ingestor, events } = await setup({ storage });

    const sent = await envelopeFor(alice, bob);

    await assert.rejects(ingestor.ingest([sent.buffer]), fault);
    assert.deepEqual(events, []);

    storage.failOn = {};
    await ingestor.ingest([sent.buffer]);

    assert.equal((await storage.envelopesGet()).length, 1);
});

// ============================================================
// One at a time
// ============================================================

test("the same envelope ingested by two relays at once is stored and counted once", async () => {

    const { bob, alice, storage, ingestor, of } = await setup({ storage: new SlowStorage() });
    const sent = await envelopeFor(alice, bob);

    await Promise.all([
        ingestor.ingest([sent.buffer], "http://one.test"),
        ingestor.ingest([sent.buffer], "http://two.test"),
    ]);

    assert.equal(of("envelope").length, 1);
    assert.equal((await storage.conversationsGet())[0].unreadCount, 1);
});

test("concurrent batches into one conversation lose no unread increment", async () => {

    const { bob, alice, storage, ingestor } = await setup({ storage: new SlowStorage() });

    const batches = [];
    for (let i = 0; i < 4; i++) {
        batches.push([(await envelopeFor(alice, bob, `m${i}`)).buffer]);
    }

    await Promise.all(batches.map(batch => ingestor.ingest(batch)));

    assert.equal((await storage.conversationsGet())[0].unreadCount, 4);
});

// ============================================================
// markRead
// ============================================================

test("markRead resets unread, announces the conversation and returns it", async () => {

    const { bob, alice, storage, ingestor, of } = await setup();

    await ingestor.ingest([(await envelopeFor(alice, bob)).buffer]);

    const conversation = await ingestor.markRead(alice.publicKeyHex);

    assert.equal(conversation.unreadCount, 0);
    assert.deepEqual(await storage.conversationsGet(), [conversation]);
    assert.deepEqual(of("conversation").at(-1), { type: "conversation", conversation, created: false });
});

test("markRead returns null when there is no conversation or nothing unread", async () => {

    const { bob, alice, ingestor, of } = await setup();

    assert.equal(await ingestor.markRead(alice.publicKeyHex), null);

    await ingestor.ingest([(await envelopeFor(bob, alice)).buffer]);
    const announced = of("conversation").length;

    assert.equal(await ingestor.markRead(alice.publicKeyHex), null);
    assert.equal(of("conversation").length, announced);

    assert.throws(() => ingestor.markRead(42));
});

test("markRead waits for the ingests before it, and the ones after it count", async () => {

    const { bob, alice, storage, ingestor } = await setup({ storage: new SlowStorage() });

    const first = ingestor.ingest([(await envelopeFor(alice, bob, "1")).buffer]);
    const read = ingestor.markRead(alice.publicKeyHex);
    const second = ingestor.ingest([(await envelopeFor(alice, bob, "2")).buffer]);

    await Promise.all([first, read, second]);

    assert.equal((await read).unreadCount, 0);
    assert.equal((await storage.conversationsGet())[0].unreadCount, 1);
});

test("the constructor insists on its dependencies", async () => {

    const ok = {
        identity: await identity(),
        storage: new StorageMemory(),
        logger: new RecordingLogger(),
    };

    assert.doesNotThrow(() => new Ingestor(ok));

    for (const broken of [{ identity: {} }, { storage: null }, { logger: undefined }, { onEnvelope: "x" }]) {
        assert.throws(() => new Ingestor({ ...ok, ...broken }), JSON.stringify(broken));
    }
});
