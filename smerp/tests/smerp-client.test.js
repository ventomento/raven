import test from "node:test";
import assert from "node:assert/strict";

import {
    SmerpClient,
    ClientStatus,
    EventTypes,
    NotStartedError,
    DispatchError,
    ContentTypes,
    PrivateIdentity,
} from "../../index.js";

import { SmerpServer } from "../src/server/index.js";
import { TransportDefault } from "../src/transport/transport-default.js";
import { StorageMemory } from "../src/storage/storage-memory.js";
import { VirtualClock, FakeRelays } from "./helpers/fakes.js";

// End-to-end against the mock relay on an ephemeral port.

// Cleanup is registered with t.after so a failed assertion does not
// leave a server or client running and hang the test process.

async function startRelay(t, options) {

    const server = new SmerpServer(options);
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return {
        server,
        relay: {
            relayUrl: `http://127.0.0.1:${server.server.address().port}`,
            relayType: "archive",
        },
    };
}

async function startClient(t, relay) {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
        syncIntervalMs: 60 * 60 * 1000,
    });

    await client.start();
    t.after(() => client.stop());

    if (relay) {
        await client.relaysPut(relay);
    }

    return client;
}

function nextEvent(client, type, predicate = () => true) {
    return new Promise((resolve) => {
        const off = client.on(type, (event) => {
            if (predicate(event)) {
                off();
                resolve(event);
            }
        });
    });
}

test("methods throw NotStartedError before start and after stop", async (t) => {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
    });

    assert.equal(client.status, ClientStatus.STOPPED);
    await assert.rejects(client.relaysGet(), NotStartedError);
    assert.throws(() => client.sync(), NotStartedError);

    await client.start();
    assert.equal(client.status, ClientStatus.RUNNING);
    assert.match(client.publicKeyHex, /^(0x)?[0-9a-f]{64}$/);

    await client.stop();
    assert.equal(client.status, ClientStatus.STOPPED);
    await assert.rejects(client.envelopesGet(), NotStartedError);
});

test("status events follow the lifecycle", async (t) => {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
    });

    const statuses = [];
    client.on(EventTypes.STATUS, (e) => statuses.push(e.status));

    await client.start();
    await client.stop();
    await new Promise(r => setTimeout(r, 0));

    assert.deepEqual(statuses, ["starting", "running", "stopping", "stopped"]);
});

test("relays: put, get, delete with events", async (t) => {

    const client = await startClient(t);
    const relay = {
        relayUrl: "http://127.0.0.1:1",
        relayType: "archive",
    };

    const putEvent = nextEvent(client, EventTypes.RELAY);
    assert.equal(await client.relaysPut(relay), relay.relayUrl);
    assert.equal((await putEvent).deleted, false);

    // put with the same url replaces, does not duplicate
    await client.relaysPut({ ...relay, relayType: "other" });
    const relays = await client.relaysGet();
    assert.equal(relays.length, 1);
    assert.equal(relays[0].relayType, "other");

    assert.equal((await client.relaysGet({ relayUrl: relay.relayUrl })).length, 1);
    assert.equal((await client.relaysGet({ relayUrl: "http://nope" })).length, 0);

    const deleteEvent = nextEvent(client, EventTypes.RELAY, e => e.deleted);
    assert.equal(await client.relaysDelete({ relayUrl: relay.relayUrl }), 1);
    assert.equal((await deleteEvent).relay.relayUrl, relay.relayUrl);
    assert.equal(await client.relaysDelete({ relayUrl: relay.relayUrl }), 0);
    assert.deepEqual(await client.relaysGet(), []);

    await assert.rejects(client.relaysPut({ relayUrl: "x" }));
});

test("send without relays throws DispatchError", async (t) => {

    const client = await startClient(t);
    const bob = await PrivateIdentity.generate();

    await assert.rejects(
        client.send(await bob.exportPublicHex(), "hi"),
        (error) => error instanceof DispatchError && error.failed.length === 0
    );
});

test("send accepts only string or Uint8Array", async (t) => {

    const { relay } = await startRelay(t);
    const client = await startClient(t, relay);

    for (const plaintext of [{ not: "bytes" }, new ArrayBuffer(4), 42]) {
        await assert.rejects(
            client.send(client.publicKeyHex, plaintext),
            TypeError
        );
    }
});

test("text and bytes round-trip between two clients through a relay", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    // text. Subscribe first: bob's background sync may fetch it any time.
    const received = nextEvent(bob, EventTypes.ENVELOPE);
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

    await bob.sync();

    const { envelope } = await received;
    assert.equal(envelope.uuid, sent.uuid);
    assert.equal(envelope.direction, "inbound");
    assert.equal(envelope.plaintext, "hello bob");

    // bytes
    const bytes = new Uint8Array([0, 1, 2, 255]);

    const sentBytes = await alice.send(bob.publicKeyHex, bytes);

    await bob.sync();

    const [binary] = await bob.envelopesGet({ uuid: sentBytes.uuid });
    assert.equal(binary.contentType, ContentTypes.UNKNOWN);
    assert.ok(binary.plaintext instanceof Uint8Array);
    assert.deepEqual(binary.plaintext, bytes);

    assert.equal(
        (await bob.envelopesGet({ publicKeyHex: alice.publicKeyHex })).length,
        2
    );

    // repeated syncs do not store anything twice
    await alice.sync();
    await alice.sync();
    assert.equal(
        (await alice.envelopesGet({ publicKeyHex: bob.publicKeyHex })).length,
        2
    );

});

test("many small envelopes are fetched with one request", async (t) => {

    const { relay } = await startRelay(t);
    const alice = await startClient(t, relay);

    // bob counts the GETs it makes
    const gets = [];
    const bob = new SmerpClient({
        identity: await PrivateIdentity.generate(),
        syncIntervalMs: 60 * 60 * 1000,
        transporter: {
            transport: (request) => {
                if ((request.options?.method ?? "GET") === "GET") {
                    gets.push(request.url);
                }
                return TransportDefault.transport(request);
            },
        },
    });
    await bob.start();
    t.after(() => bob.stop());

    for (let i = 0; i < 30; i++) {
        await alice.send(bob.publicKeyHex, `m${i}`);
    }

    await bob.relaysPut(relay);
    await bob.sync();

    assert.equal((await bob.envelopesGet()).length, 30);
    // first contact (unsigned, 401, retried signed) with the whole batch, then 204
    assert.equal(gets.length, 3);
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
    assert.equal(received.plaintext.byteLength, largest.byteLength);
    assert.deepEqual(received.plaintext, largest);

    await assert.rejects(
        alice.send(bob.publicKeyHex, new Uint8Array(largest.byteLength + 1)),
        /too large/
    );
});

test("the client learns the relay pkh and recovers when the relay rotates it", async (t) => {

    const { server, relay } = await startRelay(t);
    const client = await startClient(t);

    await client.relaysPut(relay);
    await client.sync();

    let [stored] = await client.relaysGet();
    assert.equal(stored.relayPkh, await server.relayPkh());
    assert.equal(stored.failureCount, 0);

    const rotated = await server.rotateKey();
    await client.sync();

    [stored] = await client.relaysGet();
    assert.equal(stored.relayPkh, rotated);
    assert.equal(stored.failureCount, 0);
});

test("an envelope held by several relays is stored and counted once", async (t) => {

    const one = await startRelay(t);
    const two = await startRelay(t);
    const alice = await startClient(t, one.relay);
    await alice.relaysPut(two.relay);
    const bob = await startClient(t, one.relay);
    await bob.relaysPut(two.relay);

    const sent = await alice.send(bob.publicKeyHex, "hi");
    assert.equal(sent.delivered.length, 2);

    let envelopeEvents = 0;
    bob.on(EventTypes.ENVELOPE, () => envelopeEvents++);

    await bob.sync();
    await new Promise(r => setTimeout(r, 0));

    assert.equal(envelopeEvents, 1);
    assert.equal((await bob.envelopesGet()).length, 1);

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});

test("conversations track unread count and can be marked read with put", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    await alice.send(bob.publicKeyHex, "one");
    await alice.send(bob.publicKeyHex, "two");
    await bob.sync();

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 2);

    const updated = nextEvent(bob, EventTypes.CONVERSATION);
    await bob.conversationsPut({ ...conversation, unreadCount: 0 });
    assert.equal((await updated).conversation.unreadCount, 0);

    const [read] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(read.unreadCount, 0);

    // sender side: outbound messages are not unread
    const [aliceSide] = await alice.conversationsGet({ publicKeyHex: bob.publicKeyHex });
    assert.equal(aliceSide.unreadCount, 0);

});

test("records returned by get are detached copies", async (t) => {

    const { server, relay } = await startRelay(t);
    const client = await startClient(t, relay);

    const [r] = await client.relaysGet();
    r.relayType = "mutated";

    const [again] = await client.relaysGet();
    assert.equal(again.relayType, "archive");

});

// =====================================================
// Relay protection and health, with a fake transport
// =====================================================

async function startFakeClient(t, { relayUrls = [], storage = new StorageMemory() } = {}) {

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);

    for (const relayUrl of relayUrls) {
        await storage.relaysPut({ relayUrl, relayType: "archive" });
    }

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
        transporter: relays,
        storage,
        clock,
        syncIntervalMs: 60 * 60 * 1000,
    });

    await client.start();
    t.after(() => client.stop());
    await client.sync();

    return { client, clock, relays, storage };
}

test("start re-enables relays that an older version disabled after failures", async (t) => {

    const storage = new StorageMemory();
    await storage.init();
    const base = { relayType: "archive" };
    await storage.relaysPut({ ...base, relayUrl: "http://legacy.test", disabled: true, failureCount: 3 });
    await storage.relaysPut({ ...base, relayUrl: "http://user.test", disabled: true, failureCount: 0 });

    const { client } = await startFakeClient(t, { storage });

    const [legacy] = await client.relaysGet({ relayUrl: "http://legacy.test" });
    assert.equal(legacy.disabled, false);
    assert.equal(legacy.failureCount, 0);

    const [user] = await client.relaysGet({ relayUrl: "http://user.test" });
    assert.equal(user.disabled, true);
});

test("send skips disabled relays", async (t) => {

    const { client, relays, storage } = await startFakeClient(t, {
        relayUrls: ["http://on.test", "http://off.test"],
    });

    const [off] = await client.relaysGet({ relayUrl: "http://off.test" });
    await client.relaysPut({ ...off, disabled: true });

    const sent = await client.send(client.publicKeyHex, "hi");

    assert.deepEqual(sent.delivered, ["http://on.test"]);
    assert.equal(
        relays.requests.filter(r => r.method === "POST" && r.relayUrl === "http://off.test").length,
        0
    );
});

test("a 429 on send pauses that relay, later sends fail fast for it", async (t) => {

    const { client, clock, relays } = await startFakeClient(t, {
        relayUrls: ["http://busy.test", "http://ok.test"],
    });

    relays.hook = (request) =>
        request.method === "POST" && request.relayUrl === "http://busy.test"
            ? { status: 429, headers: { "retry-after": "60" } }
            : null;

    const first = await client.send(client.publicKeyHex, "one");
    assert.deepEqual(first.delivered, ["http://ok.test"]);

    const posts = () => relays.requests.filter(r => r.method === "POST" && r.relayUrl === "http://busy.test").length;
    assert.equal(posts(), 1);

    const second = await client.send(client.publicKeyHex, "two");
    assert.deepEqual(second.failed.map(f => f.relayUrl), ["http://busy.test"]);
    assert.match(second.failed[0].error.message, /asked to wait/);
    assert.equal(posts(), 1);

    clock.advance(60 * 1000);
    relays.hook = null;

    const third = await client.send(client.publicKeyHex, "three");
    assert.equal(third.delivered.length, 2);
});

// =====================================================
// Relay auth: keys learned on send, access tokens
// =====================================================

const RELAY_PKH = "ab".repeat(32);

test("a POST to a relay with an unknown key is retried signed and the key is saved", async (t) => {

    const { client, relays } = await startFakeClient(t);

    // Only POSTs announce the key, so the sync started by relaysPut
    // cannot learn it first.
    relays.hook = (request) => {
        if (request.method === "GET") {
            return { status: 204, headers: {} };
        }
        return request.signed
            ? { status: 200, headers: { "x-smerp-relay-pkh": RELAY_PKH } }
            : { status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } };
    };

    await client.relaysPut({ relayUrl: "http://new.test", relayType: "relay" });

    const learned = nextEvent(client, EventTypes.RELAY, e => e.relay.relayPkh === RELAY_PKH);

    const sent = await client.send(client.publicKeyHex, "hi");

    assert.deepEqual(sent.delivered, ["http://new.test"]);
    assert.deepEqual(
        relays.requests.filter(r => r.method === "POST").map(r => r.signed),
        [false, true]
    );

    await learned;
    const [stored] = await client.relaysGet({ relayUrl: "http://new.test" });
    assert.equal(stored.relayPkh, RELAY_PKH);
});

test("a relay token is sent on GET and POST to its own relay only", async (t) => {

    const { client, relays } = await startFakeClient(t);

    await client.relaysPut({ relayUrl: "http://paid.test", relayType: "archive", relayToken: "secret" });
    await client.relaysPut({ relayUrl: "http://free.test", relayType: "relay" });

    await client.send(client.publicKeyHex, "hi");
    await client.sync();

    const tokensFor = (relayUrl, method) => relays.requests
        .filter(r => r.relayUrl === relayUrl && r.method === method)
        .map(r => r.authorization);

    for (const method of ["GET", "POST"]) {
        assert.ok(tokensFor("http://paid.test", method).length > 0, method);
        assert.ok(tokensFor("http://paid.test", method).every(a => a === "Bearer secret"), method);
        assert.ok(tokensFor("http://free.test", method).every(a => a === undefined), method);
    }
});

test("a 401 on send reports the relay's reason", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: ["http://strict.test"] });

    relays.hook = (request) => request.method === "POST"
        ? { status: 401, headers: { "x-smerp-unauthorized": "subscription expired" } }
        : null;

    const error = await client.send(client.publicKeyHex, "hi").catch(e => e);

    assert.ok(error instanceof DispatchError);
    assert.match(error.failed[0].error.message, /401 \(subscription expired\)/);
});

test("with a token, a client can use a token-gated relay end to end", async (t) => {

    const { relay } = await startRelay(t, { tokens: new Set(["secret"]) });

    const alice = await startClient(t, { ...relay, relayToken: "secret" });
    const mallory = await startClient(t, relay);

    await alice.send(alice.publicKeyHex, "note to self");
    await alice.sync();
    assert.equal((await alice.envelopesGet()).length, 1);

    await assert.rejects(mallory.send(alice.publicKeyHex, "hi"), DispatchError);

    await mallory.sync();
    const [stored] = await mallory.relaysGet();
    assert.equal(stored.failureCount > 0, true);
    assert.match(stored.lastFailureReason, /access token/);
});
