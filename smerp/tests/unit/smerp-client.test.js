import test from "node:test";
import assert from "node:assert/strict";

import {
    SmerpClient,
    ClientStatus,
    EventTypes,
    NotStartedError,
    DispatchError,
    ContentTypes,
} from "../../../index.js";
import { readEnvelope, bytesToHex, envelopeHash, notifyTopic } from "../../../smep/src/index.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";
import { VirtualClock, FakeRelays, tick } from "../helpers/fakes.js";
import { Scheduler } from "../../src/sync/scheduler.js";
import { encodeBatch } from "../../src/protocol/index.js";
import { identity, envelopeFor, garbageFrame, deferred, RecordingLogger } from "../helpers/relay-fixtures.js";

const A = "http://a.test";
const B = "http://b.test";
const HOUR = 60 * 60 * 1000;

async function startFakeClient(t, { relayUrls = [], storage = new StorageMemory(), ...options } = {}) {

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);

    for (const relayUrl of relayUrls) {
        await storage.relaysPut({ relayUrl, relayType: "archive" });
    }

    const client = new SmerpClient({
        identity: await identity(),
        transporter: relays,
        storage,
        clock,
        syncIntervalMs: HOUR,
        ...options,
    });

    const events = [];
    for (const type of Object.values(EventTypes)) {
        client.on(type, event => events.push(event));
    }

    await client.start();
    t.after(() => client.stop());

    const sync = () => clock.drive(client.sync());

    await sync();
    await tick();

    const of = (type) => events.filter(e => e.type === type);

    return { client, clock, relays, storage, events, of, sync };
}

const posts = (relays, relayUrl) =>
    relays.requests.filter(r => r.method === "POST" && (!relayUrl || r.relayUrl === relayUrl));

const gets = (relays, relayUrl) =>
    relays.requests.filter(r => r.method === "GET" && (!relayUrl || r.relayUrl === relayUrl));

async function isSettled(promise) {

    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });

    for (let i = 0; i < 5; i++) {
        await tick();
    }

    return settled;
}

test("every method but on needs a running client", async () => {

    const client = new SmerpClient({ identity: await identity() });

    const check = async () => {
        assert.throws(() => client.sync(), NotStartedError);

        for (const call of [
            () => client.send("ab".repeat(32), "hi"),
            () => client.envelopesGet(),
            () => client.conversationsGet(),
            () => client.markRead("ab".repeat(32)),
            () => client.renameConversation("ab".repeat(32), "Alice"),
            () => client.relaysGet(),
            () => client.relaysPut({ relayUrl: A, relayType: "archive" }),
            () => client.relaysDelete({ relayUrl: A }),
            () => client.notifyTopic("ab".repeat(32)),
        ]) {
            await assert.rejects(call(), NotStartedError, call.toString());
        }
    };

    assert.equal(client.status, ClientStatus.STOPPED);
    await check();

    const off = client.on(EventTypes.STATUS, () => {});
    assert.equal(typeof off, "function");

    await client.start();
    assert.equal(client.status, ClientStatus.RUNNING);
    assert.match(client.publicKeyHex, /^[0-9a-f]{64}$/);
    assert.equal(client.publicKeyHex, client.identity.publicKeyHex);

    await client.stop();
    assert.equal(client.status, ClientStatus.STOPPED);
    await check();
});

test("STATUS events follow the lifecycle; a second start or stop does nothing", async () => {

    const client = new SmerpClient({ identity: await identity() });
    const statuses = [];
    client.on(EventTypes.STATUS, e => statuses.push(e.status));

    await client.start();
    await client.start();
    await client.stop();
    await client.stop();
    await tick();

    assert.deepEqual(statuses, ["starting", "running", "stopping", "stopped"]);
});

test("a failing start closes storage, leaves the client stopped and rethrows", async () => {

    for (const method of ["init", "relaysGet"]) {

        const fault = new Error(`${method} failed`);
        const storage = new StorageMemory();
        let closed = 0;

        storage[method] = async () => { throw fault; };
        storage.close = async () => { closed++; };

        const client = new SmerpClient({ identity: await identity(), storage });

        await assert.rejects(client.start(), fault);

        assert.equal(client.status, ClientStatus.STOPPED, method);
        assert.equal(closed, 1, method);
        assert.equal(client.syncIntervalId, null, "no interval left behind");

        delete storage[method];
        await client.start();
        assert.equal(client.status, ClientStatus.RUNNING);
        await client.stop();
    }
});

test("stop closes storage", async () => {

    const storage = new StorageMemory();
    let closed = 0;
    storage.close = async () => { closed++; };

    const client = new SmerpClient({ identity: await identity(), storage, syncIntervalMs: HOUR });
    await client.start();
    await client.stop();

    assert.equal(closed, 1);
});

test("start syncs every enabled stored relay, and only those", async (t) => {

    const storage = new StorageMemory();
    await storage.relaysPut({ relayUrl: B, relayType: "archive", disabled: true });

    const { relays, client } = await startFakeClient(t, { relayUrls: [A], storage });

    assert.equal(gets(relays, A).length, 1);
    assert.equal(gets(relays, B).length, 0);
    assert.deepEqual([...client.sessions.keys()], [A]);
});

test("the concurrency option reaches the scheduler", async (t) => {

    const { client } = await startFakeClient(t, { concurrency: 2 });

    assert.equal(client.scheduler.concurrency, 2);
});

test("the sync interval starts a sync until stop", async (t) => {

    t.mock.timers.enable({ apis: ["setInterval"] });

    const { client, relays, sync } = await startFakeClient(t, { relayUrls: [A], syncIntervalMs: 1000 });
    const before = gets(relays, A).length;

    t.mock.timers.tick(1000);
    await sync();
    assert.equal(gets(relays, A).length, before + 1);

    await client.stop();
    t.mock.timers.tick(5000);
    await tick();
    assert.equal(gets(relays, A).length, before + 1);
});

test("overlapping syncs share one promise and one SYNC start/end", async (t) => {

    const { client, relays, of } = await startFakeClient(t, { relayUrls: [A] });
    const syncsBefore = of(EventTypes.SYNC).length;

    const gate = deferred();
    relays.hook = async (request) => {
        if (request.method === "GET") {
            await gate.promise;
        }
    };

    const first = client.sync();
    const second = client.sync();
    assert.equal(first, second);

    gate.resolve();
    await first;
    await tick();

    assert.deepEqual(
        of(EventTypes.SYNC).slice(syncsBefore).map(e => e.phase),
        ["start", "end"]
    );
});

test("a synced envelope is announced: ENVELOPE, then CONVERSATION", async (t) => {

    const { client, relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });
    const alice = await identity();
    const sent = await envelopeFor(alice, client.identity, "hi");

    relays.add(A, sent.bytes);
    await sync();
    await tick();

    const [{ envelope }] = of(EventTypes.ENVELOPE);
    assert.equal(envelope.hash, sent.hash);
    assert.equal(envelope.direction, "inbound");

    const [{ conversation, created }] = of(EventTypes.CONVERSATION);
    assert.equal(conversation.publicKeyHex, alice.publicKeyHex);
    assert.equal(conversation.unreadCount, 1);
    assert.equal(created, true);

    const [stored] = await client.relaysGet();
    assert.equal(stored.cursor, 1);
});

test("an unreadable envelope is reported as REJECTED with its relay", async (t) => {

    const { relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });

    const garbage = new Uint8Array(garbageFrame());

    relays.add(A, garbage);
    await sync();
    await tick();

    const [rejected] = of(EventTypes.REJECTED);
    assert.equal(rejected.hash, await envelopeHash(garbage));
    assert.equal(rejected.relayUrl, A);
    assert.equal(typeof rejected.reason, "string");
});

test("a storage error during sync is an ERROR for that relay, and the cursor stays", async (t) => {

    const { client, relays, storage, of, sync } = await startFakeClient(t, { relayUrls: [A] });
    const fault = new Error("disk full");

    relays.add(A, (await envelopeFor(await identity(), client.identity)).bytes);
    storage.envelopesPut = async () => { throw fault; };

    await sync();
    await tick();

    const [error] = of(EventTypes.ERROR);
    assert.equal(error.error, fault);
    assert.equal(error.relayUrl, A);

    const [stored] = await client.relaysGet();
    assert.equal(stored.cursor ?? 0, 0);
    assert.equal(stored.failureCount, 0, "a local fault does not blame the relay");
});

test("a relay failure is saved, announced as RELAY and ERROR once, then backed off", async (t) => {

    const { client, relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });

    relays.hook = (request) => request.method === "GET" ? { status: 500 } : null;
    const relayEvents = of(EventTypes.RELAY).length;

    await sync();
    await tick();

    const [stored] = await client.relaysGet();
    assert.equal(stored.failureCount, 1);
    assert.equal(stored.lastFailureReason, "unexpected status 500");

    const [error] = of(EventTypes.ERROR);
    assert.equal(error.relayUrl, A);
    assert.match(error.error.message, /unexpected status 500/);
    assert.equal(of(EventTypes.RELAY).length, relayEvents + 1);

    const requests = gets(relays, A).length;
    await client.sync();
    await tick();
    assert.equal(gets(relays, A).length, requests);
    assert.equal(of(EventTypes.ERROR).length, 1);
});

test("a relay that always has more cannot keep a sync open", async (t) => {

    const hostile = {
        "always a bigger cursor": (request) => ({
            status: 200,
            headers: { "x-smerp-cursor": String(request.cursor + 1) },
            body: encodeBatch([new Uint8Array(garbageFrame())]),
        }),
        "always a new relay key": () => ({
            status: 401,
            headers: { "x-smerp-relay-pkh": bytesToHex(crypto.getRandomValues(new Uint8Array(32))) },
        }),
    };

    for (const [name, respond] of Object.entries(hostile)) {

        const { relays, of, sync } = await startFakeClient(t, { relayUrls: [A, B] });
        const before = gets(relays, A).length;

        relays.hook = (request) => request.method === "GET" && request.relayUrl === A ? respond(request) : null;

        await sync();

        assert.equal(gets(relays, A).length - before, Scheduler.DEFAULTS.maxStepsPerRound, name);
        assert.equal(of(EventTypes.SYNC).at(-1).phase, "end", name);
    }
});

test("a save that only moves lastSuccessAt is not announced", async (t) => {

    const { client, clock, of, sync } = await startFakeClient(t, { relayUrls: [A] });
    const relayEvents = of(EventTypes.RELAY).length;

    const [before] = await client.relaysGet();
    clock.advance(10 * 1000);
    await sync();
    await tick();

    const [after] = await client.relaysGet();
    assert.ok(after.lastSuccessAt > before.lastSuccessAt, "saved");
    assert.equal(of(EventTypes.RELAY).length, relayEvents, "not announced");
});

test("send: argument checks", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    for (const plaintext of [{ not: "bytes" }, new ArrayBuffer(4), 42, null]) {
        await assert.rejects(client.send(client.publicKeyHex, plaintext), TypeError);
    }

    await assert.rejects(client.send(42, "hi"));
    await assert.rejects(client.send("not hex", "hi"));
    assert.equal(posts(relays).length, 0);
});

test("send: content type defaults to TEXT_UTF8 for strings, UNKNOWN for bytes", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    await client.send(client.publicKeyHex, "text");
    await client.send(client.publicKeyHex, new Uint8Array([1]));
    await client.send(client.publicKeyHex, new Uint8Array([1]), { contentType: ContentTypes.FILE });

    assert.deepEqual(
        posts(relays).map(r => readEnvelope(r.body).content_type),
        [ContentTypes.TEXT_UTF8, ContentTypes.UNKNOWN, ContentTypes.FILE]
    );
});

test("send: encrypts once, posts the same bytes to every relay, returns its hash", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A, B] });
    const bob = await identity();

    const result = await client.send(bob.publicKeyHex, "hi");

    const [toA] = posts(relays, A);
    const [toB] = posts(relays, B);

    assert.deepEqual(new Uint8Array(toA.body), new Uint8Array(toB.body));
    assert.equal(result.hash, await envelopeHash(toA.body));
    assert.deepEqual(result.delivered.sort(), [A, B]);
    assert.deepEqual(result.failed, []);

    const envelope = readEnvelope(toA.body);
    assert.equal(bytesToHex(envelope.recipient_public_key), bob.publicKeyHex);
    assert.equal(bytesToHex(envelope.sender_public_key), client.publicKeyHex);
});

test("send: DispatchError without relays, or when every relay refuses", async (t) => {

    const empty = await startFakeClient(t);

    await assert.rejects(
        empty.client.send(empty.client.publicKeyHex, "hi"),
        error => error instanceof DispatchError && error.failed.length === 0
    );

    const { client, relays } = await startFakeClient(t, { relayUrls: [A, B] });
    relays.hook = (request) => request.method === "POST" ? { status: 500 } : null;

    const error = await client.send(client.publicKeyHex, "hi").catch(e => e);

    assert.ok(error instanceof DispatchError);
    assert.deepEqual(error.failed.map(f => f.relayUrl).sort(), [A, B]);
    assert.ok(error.failed.every(f => /500/.test(f.error.message)));
});

test("send: a partial delivery lists what failed", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A, B] });
    relays.hook = (request) => request.method === "POST" && request.relayUrl === B ? { status: 400 } : null;

    const result = await client.send(client.publicKeyHex, "hi");

    assert.deepEqual(result.delivered, [A]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].relayUrl, B);
    assert.match(result.failed[0].error.message, /400/);
});

test("send: skips disabled relays", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A, B] });

    const [b] = await client.relaysGet({ relayUrl: B });
    await client.relaysPut({ ...b, disabled: true });

    const sent = await client.send(client.publicKeyHex, "hi");

    assert.deepEqual(sent.delivered, [A]);
    assert.equal(posts(relays, B).length, 0);
});

test("send: stores nothing itself; the envelope arrives through sync", async (t) => {

    const { client, relays, sync } = await startFakeClient(t, { relayUrls: [A] });
    const bob = await identity();

    const sent = await client.send(bob.publicKeyHex, "hi");
    await sync();

    assert.deepEqual(await client.envelopesGet(), []);

    relays.add(A, new Uint8Array(posts(relays, A)[0].body));
    await sync();

    const [stored] = await client.envelopesGet();
    assert.equal(stored.hash, sent.hash);
    assert.equal(stored.direction, "outbound");
    assert.equal(stored.publicKeyHex, bob.publicKeyHex);
});

test("send: starts a sync", async (t) => {

    const { client, relays, of } = await startFakeClient(t, { relayUrls: [A] });
    const before = gets(relays, A).length;
    const syncs = of(EventTypes.SYNC).length;

    await client.send(client.publicKeyHex, "hi");
    await tick();

    assert.equal(gets(relays, A).length, before + 1);
    assert.equal(of(EventTypes.SYNC)[syncs].phase, "start");
});

test("send: does not wait for a sync in progress", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A], concurrency: 1 });

    const gate = deferred();
    relays.hook = async (request) => {
        if (request.method === "GET") {
            await gate.promise;
        }
    };

    const syncing = client.sync();
    await tick();

    const sent = await client.send(client.publicKeyHex, "hi");
    assert.deepEqual(sent.delivered, [A]);
    assert.equal(await isSettled(syncing), false);

    gate.resolve();
    await syncing;
});

const NTFY = "http://ntfy.test";
const COOLDOWN = 5 * 60 * 1000;

const pushes = (relays) => relays.requests.filter(r => r.url.startsWith(`${NTFY}/`));

// A push runs after send() returns and awaits WebCrypto, so tests wait for it
// to reach the transport (or, for "no push", give it ample time not to).
async function pushed(relays, count) {

    for (let i = 0; i < 500 && pushes(relays).length < count; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    assert.equal(pushes(relays).length, count);
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 50));
}

async function startNotifyClient(t, options = {}) {

    const started = await startFakeClient(t, { relayUrls: [A, B], notify: true, ntfyUrl: `${NTFY}/`, ...options });
    const bob = await identity();

    await started.storage.conversationsPut({ publicKeyHex: bob.publicKeyHex, unreadCount: 0, hasInbound: true });

    return { ...started, bob };
}

test("notify: one push per send to the pair's topic, however many relays took it", async (t) => {

    const { client, relays, bob } = await startNotifyClient(t);

    await client.send(bob.publicKeyHex, "hi");
    await pushed(relays, 1);
    await settle();

    const [push, ...more] = pushes(relays);

    assert.deepEqual(more, []);
    assert.equal(push.method, "POST");
    assert.equal(push.url, `${NTFY}/${await notifyTopic(bob, client.publicKeyHex, bob.publicKeyHex)}`);
    assert.deepEqual(push.headers, { "Title": "raven", "X-Sequence-ID": "raven" });
    assert.equal(push.body, "raven: new envelope received");
    assert.equal(posts(relays, A).length, 1);
    assert.equal(posts(relays, B).length, 1);
});

test("notify: no push when off, to a peer we never heard from, or to ourselves", async (t) => {

    const off = await startNotifyClient(t, { notify: false });
    await off.client.send(off.bob.publicKeyHex, "hi");

    const { client, relays } = await startNotifyClient(t);
    const stranger = await identity();
    await client.storage.conversationsPut({ publicKeyHex: stranger.publicKeyHex, unreadCount: 0 });

    await client.send(stranger.publicKeyHex, "cold");
    await client.send((await identity()).publicKeyHex, "no conversation");
    await client.send(client.publicKeyHex, "note");
    await settle();

    assert.deepEqual(pushes(off.relays), []);
    assert.deepEqual(pushes(relays), []);
});

test("notify: no push when no relay accepted the envelope", async (t) => {

    const { client, relays, bob } = await startNotifyClient(t);
    relays.hook = (request) => request.method === "POST" && !request.url.startsWith(NTFY) ? { status: 500 } : null;

    await assert.rejects(client.send(bob.publicKeyHex, "hi"), DispatchError);
    await settle();

    assert.deepEqual(pushes(relays), []);
});

test("notify: a refused, failing or hanging push never affects send", async (t) => {

    const { client, clock, relays, bob } = await startNotifyClient(t);
    const gate = deferred();

    const answers = [
        () => ({ status: 500 }),
        () => { throw new Error("offline"); },
        () => gate.promise,
    ];
    relays.hook = (request) => request.url.startsWith(NTFY) ? answers.shift()() : null;

    for (let i = 1; i <= 3; i++) {
        const sent = await client.send(bob.publicKeyHex, "hi");
        assert.deepEqual(sent.delivered.sort(), [A, B]);
        await pushed(relays, i);
        clock.advance(COOLDOWN);
    }

    gate.resolve(null);
});

test("notify: a 429 pauses pushes for its Retry-After", async (t) => {

    const { client, clock, relays, bob } = await startNotifyClient(t);

    relays.hook = (request) => request.url.startsWith(NTFY) ? { status: 429, headers: { "retry-after": "600" } } : null;
    await client.send(bob.publicKeyHex, "1");
    await pushed(relays, 1);
    await settle();

    relays.hook = null;
    clock.advance(COOLDOWN);
    await client.send(bob.publicKeyHex, "2");
    await settle();
    assert.equal(pushes(relays).length, 1, "paused past the cooldown");

    clock.advance(600 * 1000 - COOLDOWN);
    await client.send(bob.publicKeyHex, "3");
    await pushed(relays, 2);
});

test("notify: at most one push per peer per 5 minutes, failed or not", async (t) => {

    const { client, clock, relays, bob } = await startNotifyClient(t);
    const carol = await identity();
    await client.storage.conversationsPut({ publicKeyHex: carol.publicKeyHex, unreadCount: 0, hasInbound: true });

    relays.hook = (request) => request.url.startsWith(NTFY) ? { status: 500 } : null;
    await Promise.all([client.send(bob.publicKeyHex, "1"), client.send(bob.publicKeyHex, "2")]);
    await pushed(relays, 1);

    relays.hook = null;
    await client.send(carol.publicKeyHex, "other peer");
    await pushed(relays, 2);

    clock.advance(COOLDOWN - 1);
    await client.send(bob.publicKeyHex, "3");
    await settle();
    assert.equal(pushes(relays).length, 2, "still cooling down");

    clock.advance(1);
    await client.send(bob.publicKeyHex, "4");
    await pushed(relays, 3);
    await settle();

    const topic = peer => notifyTopic(peer, client.publicKeyHex, peer.publicKeyHex);
    assert.deepEqual(
        pushes(relays).map(r => r.url),
        [`${NTFY}/${await topic(bob)}`, `${NTFY}/${await topic(carol)}`, `${NTFY}/${await topic(bob)}`]
    );
});

test("notify: options are checked, ntfyUrl loses trailing slashes", async () => {

    const id = await identity();

    assert.equal(new SmerpClient({ identity: id }).ntfyUrl, "https://ntfy.sh");
    assert.equal(new SmerpClient({ identity: id }).notify, false);
    assert.equal(new SmerpClient({ identity: id, ntfyUrl: "http://localhost:81//" }).ntfyUrl, "http://localhost:81");

    for (const options of [
        { notify: "yes" },
        { notify: null },
        { ntfyUrl: 42 },
        { ntfyUrl: "not a url" },
        { ntfyUrl: "ftp://ntfy.test" },
    ]) {
        assert.throws(() => new SmerpClient({ identity: id, ...options }), JSON.stringify(options));
    }
});

test("notifyTopic: the topic the peer pushes to us on", async (t) => {

    const { client, bob } = await startNotifyClient(t);

    assert.equal(
        await client.notifyTopic(bob.publicKeyHex),
        await notifyTopic(bob, bob.publicKeyHex, client.publicKeyHex)
    );
    await assert.rejects(client.notifyTopic(client.publicKeyHex), /note to self/);
});

test("notify: the topic never reaches the log", async (t) => {

    const entries = [];
    const logger = new RecordingLogger({ entries });
    const { client, relays, bob } = await startNotifyClient(t, { logger });

    relays.hook = (request) => request.url.startsWith(NTFY) ? { status: 500 } : null;
    await client.send(bob.publicKeyHex, "hi");
    await pushed(relays, 1);
    await settle();

    const topic = await notifyTopic(bob, client.publicKeyHex, bob.publicKeyHex);

    assert.ok(entries.some(([, message]) => message === "ntfy push refused"));
    assert.ok(!JSON.stringify(entries).includes(topic));
});

test("conversationsGet: newest lastMessageAt first", async (t) => {

    const storage = new StorageMemory();

    for (const [publicKeyHex, lastMessageAt] of [["p1", 1], ["p3", 3], ["none", undefined], ["p2", 2]]) {
        await storage.conversationsPut({ publicKeyHex, unreadCount: 0, lastMessageAt });
    }

    const { client } = await startFakeClient(t, { storage });

    assert.deepEqual(
        (await client.conversationsGet()).map(c => c.publicKeyHex),
        ["p3", "p2", "p1", "none"]
    );
    assert.deepEqual(
        (await client.conversationsGet({ publicKeyHex: "p2" })).map(c => c.publicKeyHex),
        ["p2"]
    );
});

test("envelopesGet passes its options to storage", async (t) => {

    const storage = new StorageMemory();
    const seen = [];
    storage.envelopesGet = async (options) => { seen.push(options); return []; };

    const { client } = await startFakeClient(t, { storage });
    const options = { publicKeyHex: "p", beforeSentAt: 5, beforeReceivedAt: 6, limit: 2 };

    await client.envelopesGet(options);

    assert.deepEqual(seen.at(-1), options);
});

test("markRead resets unread and announces the conversation", async (t) => {

    const { client, relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });
    const alice = await identity();

    relays.add(A, (await envelopeFor(alice, client.identity)).bytes);
    await sync();

    const conversation = await client.markRead(alice.publicKeyHex);
    await tick();

    assert.equal(conversation.unreadCount, 0);
    assert.deepEqual(of(EventTypes.CONVERSATION).at(-1).conversation, conversation);
    assert.equal(of(EventTypes.CONVERSATION).at(-1).created, false);
    assert.equal((await client.conversationsGet())[0].unreadCount, 0);

    assert.equal(await client.markRead(alice.publicKeyHex), null);
});

test("renameConversation names the conversation and announces it", async (t) => {

    const { client, relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });
    const alice = await identity();

    assert.equal(await client.renameConversation(alice.publicKeyHex, "Alice"), null);

    relays.add(A, (await envelopeFor(alice, client.identity)).bytes);
    await sync();

    const conversation = await client.renameConversation(alice.publicKeyHex, "Alice");
    await tick();

    assert.equal(conversation.name, "Alice");
    assert.deepEqual(of(EventTypes.CONVERSATION).at(-1).conversation, conversation);
    assert.equal((await client.conversationsGet())[0].name, "Alice");
});

test("relaysPut: insert, replace, announce, return the url", async (t) => {

    const { client, of } = await startFakeClient(t);

    assert.equal(await client.relaysPut({ relayUrl: A, relayType: "archive" }), A);
    await client.relaysPut({ relayUrl: A, relayType: "relay" });
    await tick();

    const relays = await client.relaysGet();
    assert.equal(relays.length, 1);
    assert.equal(relays[0].relayType, "relay");

    const announced = of(EventTypes.RELAY).filter(e => e.relay.relayUrl === A && !e.deleted);
    assert.ok(announced.some(e => e.relay.relayType === "archive"));
    assert.ok(announced.some(e => e.relay.relayType === "relay"));
});

test("relaysPut: argument checks", async (t) => {

    const { client } = await startFakeClient(t);

    await assert.rejects(client.relaysPut({ relayType: "archive" }));
    await assert.rejects(client.relaysPut({ relayUrl: A }));
    await assert.rejects(client.relaysPut({ relayUrl: A, relayType: "archive", relayToken: 5 }));
    assert.equal(await client.relaysPut({ relayUrl: A, relayType: "archive", relayToken: null }), A);
});

test("relaysPut keeps the stored sync fields unless it sets them", async (t) => {

    const RELAY_PKH = "ab".repeat(32);
    const storage = new StorageMemory();
    await storage.relaysPut({ relayUrl: A, relayType: "archive", cursor: 5, relayPkh: RELAY_PKH });

    const { client } = await startFakeClient(t, { storage });

    await client.relaysPut({ relayUrl: A, relayType: "relay", relayToken: "t" });

    let [stored] = await client.relaysGet();
    assert.equal(stored.cursor, 5);
    assert.equal(stored.relayPkh, RELAY_PKH);
    assert.equal(stored.relayType, "relay");
    assert.equal(stored.relayToken, "t");

    await client.relaysPut({ relayUrl: A, relayType: "relay", cursor: 0, relayPkh: null });

    [stored] = await client.relaysGet();
    assert.equal(stored.cursor, 0);
    assert.equal(stored.relayPkh, null);
});

test("relaysPut: a new relay is synced at once; a disabled one not at all", async (t) => {

    const { client, relays } = await startFakeClient(t);

    await client.relaysPut({ relayUrl: A, relayType: "archive" });
    await tick();
    assert.equal(gets(relays, A).length, 1);

    const [a] = await client.relaysGet();
    await client.relaysPut({ ...a, disabled: true });
    await client.sync();
    assert.equal(gets(relays, A).length, 1);
    assert.equal(client.sessions.size, 0);
});

test("relaysPut waits for running steps before rebuilding", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    const gate = deferred();
    relays.hook = async (request) => {
        if (request.method === "GET") {
            await gate.promise;
        }
    };

    client.sync();
    await tick();

    const put = client.relaysPut({ relayUrl: B, relayType: "archive" });
    assert.equal(await isSettled(put), false);

    gate.resolve();
    relays.hook = null;
    await put;

    assert.deepEqual([...client.sessions.keys()].sort(), [A, B]);
});

test("concurrent relay changes all land", async (t) => {

    const { client } = await startFakeClient(t);

    await Promise.all([
        client.relaysPut({ relayUrl: A, relayType: "archive" }),
        client.relaysPut({ relayUrl: B, relayType: "archive" }),
        client.relaysPut({ relayUrl: "http://c.test", relayType: "archive" }),
        client.relaysDelete({ relayUrl: "http://c.test" }),
    ]);

    assert.deepEqual((await client.relaysGet()).map(r => r.relayUrl).sort(), [A, B]);
    assert.deepEqual([...client.sessions.keys()].sort(), [A, B]);
});

test("relaysDelete: count, announce, stop syncing it", async (t) => {

    const { client, relays, of, sync } = await startFakeClient(t, { relayUrls: [A] });

    assert.equal(await client.relaysDelete({ relayUrl: A }), 1);
    assert.equal(await client.relaysDelete({ relayUrl: A }), 0);
    await tick();

    const deleted = of(EventTypes.RELAY).filter(e => e.deleted);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].relay.relayUrl, A);

    const before = gets(relays, A).length;
    await sync();
    assert.equal(gets(relays, A).length, before);
    assert.deepEqual(await client.relaysGet(), []);

    await assert.rejects(client.relaysDelete({}));
});

async function heldPost(client, relays) {

    const RELAY_PKH = "ab".repeat(32);
    const gate = deferred();

    relays.hook = async (request) => {

        if (request.method === "GET") {
            return { status: 204 };
        }

        await gate.promise;
        return { status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } };
    };

    const sending = client.send(client.publicKeyHex, "hi").catch(e => e);

    while (posts(relays).length === 0) {
        await tick();
    }

    return {
        release: async () => {
            gate.resolve();
            return sending;
        },
    };
}

test("a save from a session replaced by a relay change is ignored", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    const post = await heldPost(client, relays);
    await client.relaysPut({ relayUrl: A, relayType: "relay" });

    assert.ok((await post.release()) instanceof DispatchError);

    const [stored] = await client.relaysGet();
    assert.equal(stored.relayType, "relay");
    assert.equal(stored.relayPkh ?? null, null);
});

test("a save after the relay was deleted does not bring it back", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    const post = await heldPost(client, relays);
    await client.relaysDelete({ relayUrl: A });

    await post.release();

    assert.deepEqual(await client.relaysGet(), []);
});

test("a relay token is sent on GET and POST to its own relay only", async (t) => {

    const { client, relays, sync } = await startFakeClient(t);

    await client.relaysPut({ relayUrl: A, relayType: "archive", relayToken: "secret" });
    await client.relaysPut({ relayUrl: B, relayType: "relay" });

    await client.send(client.publicKeyHex, "hi");
    await sync();

    for (const requests of [gets, posts]) {
        assert.ok(requests(relays, A).length > 0);
        assert.ok(requests(relays, A).every(r => r.token === "secret"));
        assert.ok(requests(relays, B).every(r => r.token === undefined));
    }
});

test("a relay change whose write fails still rebuilds: syncing and sending go on", async (t) => {

    const { client, relays, storage, sync } = await startFakeClient(t, { relayUrls: [A] });
    const fault = new Error("disk full");

    const before = gets(relays, A).length;
    const relaysPut = storage.relaysPut;
    storage.relaysPut = async () => { throw fault; };
    await assert.rejects(client.relaysPut({ relayUrl: B, relayType: "archive" }), fault);
    storage.relaysPut = relaysPut;

    assert.deepEqual([...client.sessions.keys()], [A]);

    await sync();
    assert.ok(gets(relays, A).length > before, "still syncs");

    assert.deepEqual((await client.send(client.publicKeyHex, "hi")).delivered, [A]);
});

test("a relay change pending when stop is called settles without error", async (t) => {

    const { client, relays } = await startFakeClient(t, { relayUrls: [A] });

    const gate = deferred();
    relays.hook = async (request) => {
        if (request.method === "GET") {
            await gate.promise;
        }
    };

    client.sync();
    await tick();

    const put = client.relaysPut({ relayUrl: B, relayType: "archive" });
    const stopped = client.stop();

    gate.resolve();
    relays.hook = null;

    assert.equal(await put, B);
    await stopped;
    assert.equal(client.status, ClientStatus.STOPPED);
});
