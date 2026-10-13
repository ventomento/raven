import test from "node:test";
import assert from "node:assert/strict";

import {
    SmerpClient,
    EventTypes,
    DispatchError,
    ContentTypes,
    PrivateIdentity,
} from "../../../index.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";
import { TransportDefault } from "../../src/transport/transport-default.js";
import { startRelay } from "../helpers/relay-fixtures.js";

// SmerpClients end to end against the mock relay on ephemeral ports, real
// clock and HTTP. Cleanup is registered with t.after so a failed
// assertion does not leave a server or client running.

const HOUR = 60 * 60 * 1000;

// A transporter that logs every request it passes on.
function countingTransport() {

    const requests = [];

    return {
        requests,
        gets: (relayUrl) => requests.filter(r =>
            r.options.method === "GET" && (!relayUrl || r.url.startsWith(relayUrl))
        ),
        transport: (request) => {
            requests.push(request);
            return TransportDefault.transport(request);
        },
    };
}

async function startClient(t, relays = [], options = {}) {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
        syncIntervalMs: HOUR,
        ...options,
    });

    await client.start();
    t.after(() => client.stop());

    for (const relay of [relays].flat()) {
        await client.relaysPut(relay);
    }

    return client;
}

function collect(client, type) {

    const events = [];
    client.on(type, event => events.push(event));

    return events;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("text and bytes round-trip between two clients through a relay", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);
    const bobEnvelopes = collect(bob, EventTypes.ENVELOPE);

    const sent = await alice.send(bob.publicKeyHex, "hello bob");

    assert.deepEqual(sent.delivered, [relay.relayUrl]);
    assert.deepEqual(sent.failed, []);
    assert.match(sent.uuid, /^[0-9a-f]{32}$/);

    // the sender stores its own envelope only via sync, like any other
    await alice.sync();
    const [own] = await alice.envelopesGet({ uuid: sent.uuid });
    assert.equal(own.direction, "outbound");
    assert.equal(own.plaintext, "hello bob");
    assert.equal(own.contentType, ContentTypes.TEXT_UTF8);
    assert.equal(own.publicKeyHex, bob.publicKeyHex);

    await bob.sync();
    await settle();

    const received = bobEnvelopes.find(e => e.envelope.uuid === sent.uuid).envelope;
    assert.equal(received.direction, "inbound");
    assert.equal(received.plaintext, "hello bob");
    assert.equal(received.publicKeyHex, alice.publicKeyHex);

    const bytes = new Uint8Array([0, 1, 2, 255]);
    const sentBytes = await alice.send(bob.publicKeyHex, bytes);
    await bob.sync();

    const [binary] = await bob.envelopesGet({ uuid: sentBytes.uuid });
    assert.equal(binary.contentType, ContentTypes.UNKNOWN);
    assert.ok(binary.plaintext instanceof Uint8Array);
    assert.deepEqual(binary.plaintext, bytes);

    assert.equal((await bob.envelopesGet({ publicKeyHex: alice.publicKeyHex })).length, 2);

    // repeated syncs do not store anything twice
    await alice.sync();
    await alice.sync();
    assert.equal((await alice.envelopesGet({ publicKeyHex: bob.publicKeyHex })).length, 2);
});

test("many small envelopes are fetched with one request", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);

    const transporter = countingTransport();
    const bob = await startClient(t, [], { transporter });

    for (let i = 0; i < 30; i++) {
        await alice.send(bob.publicKeyHex, `m${i}`);
    }

    await bob.relaysPut(relay);
    await bob.sync();

    assert.equal((await bob.envelopesGet()).length, 30);
    // first contact (unsigned 401 teaches the key), the whole batch, then 204
    assert.equal(transporter.gets().length, 3);
    assert.equal((await bob.relaysGet())[0].cursor, 30);
});

test("a 4 MiB envelope round-trips, one byte more is refused by send", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    // 4 MiB minus header (94), iv (12) and tag (16)
    const largest = new Uint8Array(4 * 1024 * 1024 - 122).fill(7);

    const sent = await alice.send(bob.publicKeyHex, largest, { contentType: ContentTypes.FILE });
    await bob.sync();

    const [received] = await bob.envelopesGet({ uuid: sent.uuid });
    assert.equal(received.contentType, ContentTypes.FILE);
    assert.deepEqual(received.plaintext, largest);

    await assert.rejects(
        alice.send(bob.publicKeyHex, new Uint8Array(largest.byteLength + 1)),
        /too large/
    );
});

test("the client learns the relay key and recovers when the relay rotates it", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    await bob.sync();

    let [stored] = await bob.relaysGet();
    assert.equal(stored.relayPkh, await server.relayPkh());
    assert.equal(stored.failureCount, 0);

    const rotated = await server.rotateKey();

    // a sync learns the new key without counting a failure...
    await bob.sync();
    [stored] = await bob.relaysGet();
    assert.equal(stored.relayPkh, rotated);
    assert.equal(stored.failureCount, 0);

    // ...and a send to a relay with a key it has not learned yet asks to send again
    const error = await alice.send(bob.publicKeyHex, "after rotation").catch(e => e);
    assert.ok(error instanceof DispatchError);
    assert.match(error.failed[0].error.message, /relay key learned, send again/);

    const sent = await alice.send(bob.publicKeyHex, "after rotation");
    await bob.sync();
    assert.equal((await bob.envelopesGet({ uuid: sent.uuid })).length, 1);
});

test("an envelope held by several relays is stored and counted once", async (t) => {

    const one = await startRelay(t);
    const two = await startRelay(t);
    const alice = await startClient(t, [one.relay, two.relay]);
    const bob = await startClient(t, [one.relay, two.relay]);
    const bobEnvelopes = collect(bob, EventTypes.ENVELOPE);

    const sent = await alice.send(bob.publicKeyHex, "hi");
    assert.equal(sent.delivered.length, 2);

    await bob.sync();
    await settle();

    assert.equal(bobEnvelopes.length, 1);
    assert.equal((await bob.envelopesGet()).length, 1);

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});

test("unread counts follow inbound envelopes and markRead clears them", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);
    const conversations = collect(bob, EventTypes.CONVERSATION);

    await alice.send(bob.publicKeyHex, "one");
    await alice.send(bob.publicKeyHex, "two");
    await bob.sync();

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 2);

    const read = await bob.markRead(alice.publicKeyHex);
    assert.equal(read.unreadCount, 0);
    await settle();
    assert.equal(conversations.at(-1).conversation.unreadCount, 0);
    assert.equal((await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex }))[0].unreadCount, 0);

    await alice.send(bob.publicKeyHex, "three");
    await bob.sync();
    assert.equal((await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex }))[0].unreadCount, 1);

    // sender side: outbound messages are not unread
    await alice.sync();
    const [aliceSide] = await alice.conversationsGet({ publicKeyHex: bob.publicKeyHex });
    assert.equal(aliceSide.unreadCount, 0);
});

test("records returned by get are detached copies", async (t) => {

    const { relay } = await startRelay(t);
    const client = await startClient(t, relay);

    await client.send(client.publicKeyHex, "note");
    await client.sync();

    const [r] = await client.relaysGet();
    r.relayType = "mutated";
    const [e] = await client.envelopesGet();
    e.plaintext = "mutated";
    const [c] = await client.conversationsGet();
    c.unreadCount = 99;

    assert.equal((await client.relaysGet())[0].relayType, "archive");
    assert.equal((await client.envelopesGet())[0].plaintext, "note");
    assert.notEqual((await client.conversationsGet())[0].unreadCount, 99);
});

test("with a token, a client can use a token-gated relay; without, it is told why", async (t) => {

    const { relay } = await startRelay(t, { tokens: new Set(["secret"]) });

    const alice = await startClient(t, { ...relay, relayToken: "secret" });
    const mallory = await startClient(t, relay);

    await alice.send(alice.publicKeyHex, "note to self");
    await alice.sync();
    assert.equal((await alice.envelopesGet()).length, 1);

    await assert.rejects(mallory.send(alice.publicKeyHex, "hi"), DispatchError);

    await mallory.sync();
    const [stored] = await mallory.relaysGet();
    assert.ok(stored.failureCount > 0);
    assert.match(stored.lastFailureReason, /access token/);
    assert.deepEqual(await mallory.envelopesGet(), []);
});

test("a client restarted on its storage resumes: same cursor and key, nothing twice", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);

    const identity = await PrivateIdentity.generate();
    const storage = new StorageMemory();

    const first = new SmerpClient({ identity, storage, syncIntervalMs: HOUR });
    await first.start();
    await first.relaysPut(relay);
    await alice.send(identity.publicKeyHex, "before");
    await first.sync();
    await first.stop();

    await alice.send(identity.publicKeyHex, "after");

    const transporter = countingTransport();
    const second = new SmerpClient({ identity, storage, transporter, syncIntervalMs: HOUR });
    const announced = collect(second, EventTypes.ENVELOPE);

    await second.start();
    t.after(() => second.stop());
    await second.sync();
    await settle();

    const [firstGet] = transporter.gets();
    assert.match(firstGet.url, /cursor=1$/);
    assert.equal("x-smerp-signature" in firstGet.options.headers, true, "the stored key is used");

    assert.deepEqual(announced.map(e => e.envelope.plaintext), ["after"]);
    assert.equal((await second.envelopesGet()).length, 2);
    assert.equal((await second.conversationsGet())[0].unreadCount, 2);
});

test("a dead relay does not stop sends or syncs through a live one", async (t) => {

    const { relay: live } = await startRelay(t);
    const dead = { relayUrl: "http://127.0.0.1:1", relayType: "archive" };

    const alice = await startClient(t, [live, dead]);
    const transporter = countingTransport();
    const bob = await startClient(t, [], { transporter });
    const errors = collect(bob, EventTypes.ERROR);

    await bob.relaysPut(live);
    await bob.relaysPut(dead);
    await bob.sync();
    await settle();

    const sent = await alice.send(bob.publicKeyHex, "hi");
    assert.deepEqual(sent.delivered, [live.relayUrl]);
    assert.deepEqual(sent.failed.map(f => f.relayUrl), [dead.relayUrl]);

    const [deadRecord] = await bob.relaysGet({ relayUrl: dead.relayUrl });
    assert.equal(deadRecord.failureCount, 1);
    assert.ok(errors.some(e => e.relayUrl === dead.relayUrl));

    // backing off: the next sync leaves the dead relay alone and still delivers
    const deadRequests = transporter.gets(dead.relayUrl).length;
    await bob.sync();

    assert.equal(transporter.gets(dead.relayUrl).length, deadRequests);
    assert.equal((await bob.envelopesGet({ uuid: sent.uuid })).length, 1);
});
