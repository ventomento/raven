import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../smep/src/index.js";
import { RelayPool, SessionState } from "../src/relay/relay-pool.js";
import { RelaySession } from "../src/relay/relay-session.js";
import { RelayRateLimits } from "../src/relay/rate-limits.js";
import { RelayDirectory } from "../src/state/relay-directory.js";
import { MessageStore } from "../src/state/message-store.js";
import { EnvelopeOpener } from "../src/inbox/envelope-opener.js";
import { Ingestor } from "../src/inbox/ingestor.js";
import { StorageMemory } from "../src/storage/storage-memory.js";
import { EventBus, EventTypes } from "../src/event/event-bus.js";
import { LightLog } from "../src/log/light-log.js";
import { VirtualClock, FakeRelays, tick } from "./helpers/fakes.js";

const RELAY_A = "http://relay-a.test";
const RELAY_B = "http://relay-b.test";

// The client's object graph (see client/compose.js) over fake relays.
async function setup(t, {
    relayUrls = [RELAY_A],
    slots,
    maxStepsPerWake,
    batchSize = Infinity,
} = {}) {

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);
    relays.batchSize = batchSize;

    const storage = new StorageMemory();
    const eventBus = new EventBus();
    const logger = new LightLog();
    const rateLimits = new RelayRateLimits({ clock });

    const directory = new RelayDirectory({ storage, eventBus });

    const ingestor = new Ingestor({
        opener: new EnvelopeOpener({ identity: bob, publicKeyHex: bob.publicKeyHex }),
        store: new MessageStore({ storage, eventBus, logger, clock }),
        eventBus,
        logger,
    });

    const pool = new RelayPool({
        createSession: (relay, onChange) => new RelaySession({
            relay,
            identity: bob,
            transporter: relays,
            logger,
            clock,
            bucket: rateLimits.for(relay.relayUrl),
            onChange,
        }),
        ingestor,
        directory,
        eventBus,
        logger,
        clock,
        ...(slots && { slots }),
        ...(maxStepsPerWake && { maxStepsPerWake }),
    });

    t.after(() => pool.stop());

    for (const relayUrl of relayUrls) {
        const relay = { relayUrl, relayType: "archive" };
        await storage.relaysPut(relay);
        pool.upsert(relay);
    }

    const events = [];
    for (const type of Object.values(EventTypes)) {
        eventBus.subscribe(type, (event) => events.push(event));
    }

    const eventsOf = (type) => events.filter(e => e.type === type);

    const seal = (plaintext) => encrypt({
        sender: alice,
        recipient: new PublicIdentity(bob.publicKey),
        plaintext,
    });

    // One round: wake idle sessions and run until the pool is done.
    const sync = async () => {
        await clock.drive(pool.wakeIdle());
        await tick();
    };

    // Move time; sessions whose wait ends run, and the test waits for them.
    const advance = async (ms) => {
        clock.advance(ms);
        await sync();
    };

    const relay = async (relayUrl = RELAY_A) =>
        (await storage.relaysGet({ relayUrl }))[0];

    const state = (relayUrl = RELAY_A) => pool.entries.get(relayUrl)?.state;

    return { alice, bob, clock, relays, storage, pool, events, eventsOf, seal, sync, advance, relay, state };
}

// =====================================================
// Batches
// =====================================================

test("many small envelopes arrive in one request", async (t) => {

    const { relays, seal, sync, storage, relay, eventsOf, state } = await setup(t);

    for (let i = 0; i < 50; i++) {
        relays.add(RELAY_A, await seal(`m${i}`));
    }

    await sync();

    // one batch, then the closing 204
    assert.equal(relays.requests.length, 2);
    assert.deepEqual(relays.requests.map(r => r.cursor), [0, 50]);
    assert.equal((await storage.envelopesGet()).length, 50);
    assert.equal((await relay()).cursor, 50);
    assert.equal(eventsOf(EventTypes.RELAY).length, 1);
    assert.equal(state(), SessionState.IDLE);
});

test("bad envelopes are skipped in the same batch and do not count as relay failures", async (t) => {

    const { relays, seal, sync, storage, relay, eventsOf } = await setup(t);

    const carol = await PrivateIdentity.generate();
    const foreign = await encrypt({
        sender: carol,
        recipient: new PublicIdentity(carol.publicKey),
        plaintext: "not for bob",
    });

    relays.add(RELAY_A, await seal("one"));
    relays.add(RELAY_A, new Uint8Array([1, 2, 3]).buffer);
    relays.add(RELAY_A, foreign);
    relays.add(RELAY_A, await seal("two"));

    await sync();

    const stored = await storage.envelopesGet();
    assert.deepEqual(stored.map(e => e.plaintext).sort(), ["one", "two"]);

    const r = await relay();
    assert.equal(r.cursor, 4);
    assert.equal(r.failureCount, 0);

    const rejected = eventsOf(EventTypes.REJECTED);
    assert.equal(rejected.length, 2);
    assert.deepEqual(rejected.map(e => e.cursor), [4, 4]);
    assert.equal(rejected[0].relayUrl, RELAY_A);
    assert.equal(rejected[0].uuid, null);
    assert.match(rejected[1].uuid, /^[0-9a-f]{32}$/);
    assert.equal(eventsOf(EventTypes.ERROR).length, 0);
});

// =====================================================
// Local faults
// =====================================================

test("a storage failure leaves the cursor so the next sync stores the envelope", async (t) => {

    const { relays, seal, sync, storage, relay, eventsOf, state } = await setup(t);

    relays.add(RELAY_A, await seal("hi"));

    const envelopesPut = storage.envelopesPut;
    storage.envelopesPut = async () => {
        storage.envelopesPut = envelopesPut;
        throw new Error("QuotaExceededError");
    };

    await sync();

    assert.equal((await relay()).cursor, undefined);
    assert.equal((await relay()).failureCount, undefined);
    assert.deepEqual(await storage.envelopesGet(), []);
    assert.match(eventsOf(EventTypes.ERROR)[0].error.message, /QuotaExceededError/);
    assert.equal(state(), SessionState.IDLE);

    await sync();

    assert.equal((await relay()).cursor, 1);
    assert.equal((await storage.envelopesGet()).length, 1);
});

test("an envelope stored before a failed cursor save is fetched again and counted once", async (t) => {

    const { alice, relays, seal, sync, storage, relay } = await setup(t);

    relays.add(RELAY_A, await seal("hi"));

    // Fail the cursor save, after the envelope was persisted.
    const relaysPut = storage.relaysPut;
    storage.relaysPut = async () => {
        storage.relaysPut = relaysPut;
        throw new Error("transaction aborted");
    };

    await sync();

    assert.equal((await storage.envelopesGet()).length, 1);
    assert.equal((await relay()).cursor, undefined);

    await sync();

    assert.equal((await relay()).cursor, 1);
    assert.equal((await storage.envelopesGet()).length, 1);

    const [conversation] = await storage.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});

// =====================================================
// Failures, backoff and 429: retried on their own
// =====================================================

test("401 counts as a failure, keeps the reason, and is retried after backoff", async (t) => {

    const { relays, sync, advance, relay, eventsOf, state } = await setup(t);

    relays.hook = () => ({
        status: 401,
        headers: { "x-smerp-unauthorized": "token expired" },
    });

    await sync();

    assert.equal((await relay()).failureCount, 1);
    assert.equal((await relay()).lastFailureReason, "unauthorized: token expired");
    assert.match(eventsOf(EventTypes.ERROR)[0].error.message, /unauthorized/);
    assert.equal(state(), SessionState.WAITING);

    relays.hook = null;
    await advance(RelaySession.backoffMs(1));

    assert.equal(relays.requests.length, 2);
    assert.equal((await relay()).failureCount, 0);
    assert.equal((await relay()).lastFailureReason, null);
    assert.equal(state(), SessionState.IDLE);
});

test("network errors back off exponentially and a wake does not cut the wait short", async (t) => {

    const { relays, sync, advance, relay, eventsOf } = await setup(t);

    relays.hook = () => { throw new Error("ECONNREFUSED"); };

    await sync();
    assert.equal((await relay()).failureCount, 1);
    assert.equal(eventsOf(EventTypes.ERROR).length, 1);

    // inside the 30s window: no request, even when woken
    await advance(29 * 1000);
    assert.equal(relays.requests.length, 1);

    await advance(1000);
    assert.equal(relays.requests.length, 2);
    assert.equal((await relay()).failureCount, 2);

    // second failure: 60s
    await advance(59 * 1000);
    assert.equal(relays.requests.length, 2);

    relays.hook = null;
    await advance(1000);
    assert.equal(relays.requests.length, 3);
    assert.equal((await relay()).failureCount, 0);
});

test("429 pauses the relay for Retry-After without counting a failure", async (t) => {

    const { relays, seal, sync, advance, relay, storage } = await setup(t);

    relays.add(RELAY_A, await seal("hi"));

    relays.hook = () => ({ status: 429, headers: { "retry-after": "30" } });

    await sync();
    assert.equal(relays.requests.length, 1);
    assert.equal((await relay()).failureCount ?? 0, 0);

    relays.hook = null;

    await advance(29 * 1000);
    assert.equal(relays.requests.length, 1);

    await advance(1000);
    assert.equal((await storage.envelopesGet()).length, 1);
});

// =====================================================
// Relay records
// =====================================================

test("disabled relays get no session and are not synced", async (t) => {

    const { relays, sync, pool } = await setup(t);

    pool.upsert({ relayUrl: RELAY_A, relayType: "archive", disabled: true });
    await sync();

    assert.deepEqual(pool.relayUrls(), []);
    assert.equal(relays.requests.length, 0);
});

test("a user edit during sync is kept, sync fields are written", async (t) => {

    const { relays, seal, sync, storage, relay } = await setup(t, { batchSize: 1 });

    relays.add(RELAY_A, await seal("one"));
    relays.add(RELAY_A, await seal("two"));

    relays.hook = async (request) => {
        if (request.cursor === 1) {
            await storage.relaysPut({ ...(await relay()), relayType: "edited", disabled: true });
        }
    };

    await sync();

    const r = await relay();
    assert.equal(r.relayType, "edited");
    assert.equal(r.disabled, true);
    assert.equal(r.cursor, 2);
});

test("a relay deleted during sync is not resurrected and its session is dropped", async (t) => {

    const { relays, seal, sync, storage, pool } = await setup(t, { batchSize: 1 });

    relays.add(RELAY_A, await seal("one"));
    relays.add(RELAY_A, await seal("two"));

    relays.hook = async () => {
        await storage.relaysDelete({ relayUrl: RELAY_A });
    };

    await sync();

    assert.deepEqual(await storage.relaysGet(), []);
    assert.deepEqual(pool.relayUrls(), []);
    assert.equal(relays.requests.length, 1);
});

test("the relay event is published only when sync state changed", async (t) => {

    const { relays, seal, sync, eventsOf } = await setup(t);

    relays.add(RELAY_A, await seal("hi"));

    await sync();
    assert.equal(eventsOf(EventTypes.RELAY).length, 1);
    assert.equal(eventsOf(EventTypes.RELAY)[0].relay.cursor, 1);

    await sync();
    assert.equal(eventsOf(EventTypes.RELAY).length, 1);
});

// =====================================================
// Rate limits and slots
// =====================================================

test("requests to one relay stay within burst 3 and 2 per second", async (t) => {

    const { clock, relays, seal, sync, storage } = await setup(t, { batchSize: 1 });

    for (let i = 0; i < 10; i++) {
        relays.add(RELAY_A, await seal(`m${i}`));
    }

    const start = clock.now();
    await sync();

    assert.equal((await storage.envelopesGet()).length, 10);

    // 10 batches of one + the closing 204
    const times = relays.requests.map(r => r.at - start);
    assert.equal(times.length, 11);

    times.forEach((t, i) => {
        assert.ok(t >= Math.max(0, i - 2) * 500, `request ${i} at ${t}ms`);
    });
});

test("relays are rate limited independently", async (t) => {

    const { clock, relays, seal, sync } = await setup(t, {
        relayUrls: [RELAY_A, RELAY_B],
        batchSize: 1,
    });

    for (let i = 0; i < 6; i++) {
        relays.add(RELAY_A, await seal(`a${i}`));
        relays.add(RELAY_B, await seal(`b${i}`));
    }

    const start = clock.now();
    await sync();

    for (const relayUrl of [RELAY_A, RELAY_B]) {
        const times = relays.requestsTo(relayUrl).map(r => r.at - start);
        assert.equal(times.length, 7, relayUrl);
        times.forEach((t, i) => {
            assert.ok(t >= Math.max(0, i - 2) * 500, `${relayUrl} request ${i} at ${t}ms`);
        });
    }
});

test("one slot serves relays in turn, one request at a time", async (t) => {

    const { relays, seal, sync } = await setup(t, {
        relayUrls: [RELAY_A, RELAY_B],
        slots: 1,
        batchSize: 1,
    });

    for (let i = 0; i < 2; i++) {
        relays.add(RELAY_A, await seal(`a${i}`));
        relays.add(RELAY_B, await seal(`b${i}`));
    }

    await sync();

    assert.deepEqual(
        relays.requests.map(r => r.relayUrl === RELAY_A ? "A" : "B"),
        ["A", "B", "A", "B", "A", "B"]
    );
});

test("a throttled relay gives up its slot and the round ends without it", async (t) => {

    const { relays, seal, sync, storage, state } = await setup(t, {
        relayUrls: [RELAY_A, RELAY_B],
        slots: 1,
    });

    relays.add(RELAY_B, await seal("b"));

    relays.hook = (request) => request.relayUrl === RELAY_A
        ? { status: 429, headers: { "retry-after": "600" } }
        : null;

    await sync();

    assert.equal(state(RELAY_A), SessionState.WAITING);
    assert.equal(state(RELAY_B), SessionState.IDLE);
    assert.equal((await storage.envelopesGet()).length, 1);
});

test("the step cap sends a relay that never runs dry back to IDLE", async (t) => {

    const { relays, seal, sync, state } = await setup(t, {
        maxStepsPerWake: 2,
        batchSize: 1,
    });

    for (let i = 0; i < 5; i++) {
        relays.add(RELAY_A, await seal(`m${i}`));
    }

    await sync();
    assert.equal(relays.requests.length, 2);
    assert.equal(state(), SessionState.IDLE);

    await sync();
    assert.equal(relays.requests.length, 4);
});

// =====================================================
// Rounds, sends, stop
// =====================================================

test("a round publishes sync start and end, and wakeIdle shares a running round", async (t) => {

    const { relays, seal, pool, clock, eventsOf } = await setup(t);

    relays.add(RELAY_A, await seal("hi"));

    const first = pool.wakeIdle();
    const second = pool.wakeIdle();

    assert.equal(first, second);

    await clock.drive(first);
    await tick();

    assert.deepEqual(eventsOf(EventTypes.SYNC).map(e => e.phase), ["start", "end"]);
});

test("a wake with no relays still starts and ends a round", async (t) => {

    const { pool, sync, eventsOf } = await setup(t, { relayUrls: [] });

    await sync();

    assert.deepEqual(pool.relayUrls(), []);
    assert.deepEqual(eventsOf(EventTypes.SYNC).map(e => e.phase), ["start", "end"]);
});

test("runNow fails fast for a throttled relay and runs otherwise", async (t) => {

    const { relays, pool } = await setup(t);

    assert.equal(await pool.runNow(RELAY_A, () => "ran"), "ran");

    relays.hook = () => ({ status: 429, headers: { "retry-after": "60" } });
    await assert.rejects(pool.runNow(RELAY_A, s => s.post(new Uint8Array(1))), /asked to wait/);
    await assert.rejects(pool.runNow(RELAY_A, () => "ran"), /asked to wait/);

    await assert.rejects(pool.runNow("http://unknown.test", () => "ran"), /not enabled/);
});

test("stop cancels the pool's timer", async (t) => {

    const { relays, sync, pool, clock } = await setup(t);

    relays.hook = () => { throw new Error("ECONNREFUSED"); };

    await sync();
    assert.equal(clock.alarms.length, 1);

    await pool.stop();
    assert.equal(clock.alarms.length, 0);
});
