import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../smep/src/index.js";
import { SyncEngine } from "../src/sync/sync-engine.js";
import { RelayRateLimits } from "../src/sync/rate-limiter.js";
import { Ingestor } from "../src/ingest/ingestor.js";
import { StorageMemory } from "../src/storage/storage-memory.js";
import { EventBus, EventTypes } from "../src/event/event-bus.js";
import { LightLog } from "../src/log/light-log.js";
import { VirtualClock, FakeRelays, tick } from "./helpers/fakes.js";

const RELAY_A = "http://relay-a.test";
const RELAY_B = "http://relay-b.test";

async function setup({ relayUrls = [RELAY_A] } = {}) {

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);
    const storage = new StorageMemory();
    const eventBus = new EventBus();
    const logger = new LightLog();

    const engine = new SyncEngine({
        identity: bob,
        transporter: relays,
        storage,
        ingestor: new Ingestor({ storage, identity: bob, eventBus, logger, clock }),
        logger,
        eventBus,
        pkh: bob.publicKeyHex,
        clock,
        rateLimits: new RelayRateLimits({ clock }),
    });

    for (const relayUrl of relayUrls) {
        await storage.relaysPut({
            relayUrl,
            relayType: "archive",
        });
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

    const sync = async () => {
        await engine.syncRelays(await storage.relaysGet());
        await tick();
    };

    const relay = async (relayUrl = RELAY_A) =>
        (await storage.relaysGet({ relayUrl }))[0];

    return { alice, bob, clock, relays, storage, engine, events, eventsOf, seal, sync, relay };
}

// =====================================================
// Ingest before cursor, skip bad envelopes
// =====================================================

test("bad envelopes are skipped in the same sync and do not count as relay failures", async () => {

    const { relays, seal, sync, storage, relay, eventsOf } = await setup();

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
    assert.deepEqual(rejected.map(e => e.cursor), [2, 3]);
    assert.equal(rejected[0].relayUrl, RELAY_A);
    assert.equal(rejected[0].uuid, null);
    assert.match(rejected[1].uuid, /^[0-9a-f]{32}$/);
    assert.equal(eventsOf(EventTypes.ERROR).length, 0);
});

test("a storage failure leaves the cursor so the next sync stores the envelope", async () => {

    const { relays, seal, sync, storage, relay, eventsOf } = await setup();

    relays.add(RELAY_A, await seal("hi"));

    const envelopesPut = storage.envelopesPut;
    storage.envelopesPut = async () => {
        storage.envelopesPut = envelopesPut;
        throw new Error("QuotaExceededError");
    };

    await sync();

    assert.equal((await relay()).cursor, undefined);
    assert.deepEqual(await storage.envelopesGet(), []);
    assert.match(eventsOf(EventTypes.ERROR)[0].error.message, /QuotaExceededError/);

    await sync();

    assert.equal((await relay()).cursor, 1);
    assert.equal((await storage.envelopesGet()).length, 1);
});

test("an envelope stored before a failed cursor save is fetched again and counted once", async () => {

    const { alice, relays, seal, sync, storage, relay } = await setup();

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

test("a non-binary 200 body is skipped and counts against the relay", async () => {

    const { relays, seal, sync, relay, storage, eventsOf } = await setup();

    relays.add(RELAY_A, "<html>oops</html>");
    relays.add(RELAY_A, await seal("hi"));

    await sync();

    const rejected = eventsOf(EventTypes.REJECTED);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /non-binary/);

    // the next envelope succeeded, which resets the failure count
    assert.equal((await relay()).cursor, 2);
    assert.equal((await relay()).failureCount, 0);
    assert.equal((await storage.envelopesGet()).length, 1);
});

// =====================================================
// Relay health and backoff
// =====================================================

test("401 counts as a relay failure and keeps the relay's reason until a success", async () => {

    const { relays, sync, relay, eventsOf, clock } = await setup();

    relays.hook = () => ({
        status: 401,
        headers: { "x-smerp-unauthorized": "token expired" },
    });

    await sync();

    assert.equal((await relay()).failureCount, 1);
    assert.equal((await relay()).lastFailureReason, "unauthorized: token expired");
    assert.match(eventsOf(EventTypes.ERROR)[0].error.message, /unauthorized/);

    relays.hook = null;
    clock.advance(SyncEngine.backoffMs(1));
    await sync();

    assert.equal((await relay()).failureCount, 0);
    assert.equal((await relay()).lastFailureReason, null);
});

// =====================================================
// Relay pkh discovery
// =====================================================

const RELAY_PKH = "ab".repeat(32);

test("an unsigned GET answered by 401 with the relay pkh is retried signed once", async () => {

    const { relays, sync, relay, eventsOf } = await setup();

    relays.hook = (request) => request.signed
        ? null
        : { status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } };

    await sync();

    assert.deepEqual(relays.requests.map(r => r.signed), [false, true]);

    const stored = await relay();
    assert.equal(stored.relayPkh, RELAY_PKH);
    assert.equal(stored.failureCount, 0);
    assert.equal(eventsOf(EventTypes.RELAY).at(-1).relay.relayPkh, RELAY_PKH);
});

test("a rotated relay pkh is adopted from a 401 and retried once", async () => {

    const { relays, storage, sync, relay } = await setup();

    await storage.relaysPut({ ...(await relay()), relayPkh: "cd".repeat(32) });

    let calls = 0;
    relays.hook = () => calls++ === 0
        ? { status: 401, headers: { "x-smerp-relay-pkh": `0x${RELAY_PKH.toUpperCase()}` } }
        : { status: 204, headers: { "x-smerp-relay-pkh": RELAY_PKH } };

    await sync();

    assert.equal(relays.requests.length, 2);
    assert.equal((await relay()).relayPkh, RELAY_PKH);
    assert.equal((await relay()).failureCount, 0);
});

test("a 401 carrying the pkh it was signed with is not retried", async () => {

    const { relays, storage, sync, relay } = await setup();

    await storage.relaysPut({ ...(await relay()), relayPkh: RELAY_PKH });

    relays.hook = () => ({ status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } });

    await sync();

    assert.equal(relays.requests.length, 1);
    assert.equal((await relay()).failureCount, 1);
});

test("a missing or malformed relay pkh header keeps the known pkh", async () => {

    const { relays, storage, sync, relay } = await setup();

    await storage.relaysPut({ ...(await relay()), relayPkh: RELAY_PKH });

    let calls = 0;
    relays.hook = () => calls++ === 0
        ? { status: 204, headers: { "x-smerp-relay-pkh": "zz" } }
        : { status: 204, headers: {} };

    await sync();
    await sync();

    assert.equal((await relay()).relayPkh, RELAY_PKH);
});

test("network errors count as failures and back off exponentially", async () => {

    const { clock, relays, sync, relay, eventsOf } = await setup();

    relays.hook = () => { throw new Error("ECONNREFUSED"); };

    await sync();
    assert.equal((await relay()).failureCount, 1);
    assert.equal(eventsOf(EventTypes.ERROR).length, 1);

    // inside the 30s window: skipped, no request
    clock.advance(29 * 1000);
    await sync();
    assert.equal(relays.requests.length, 1);

    clock.advance(1000);
    await sync();
    assert.equal(relays.requests.length, 2);
    assert.equal((await relay()).failureCount, 2);

    // second failure: 60s
    clock.advance(59 * 1000);
    await sync();
    assert.equal(relays.requests.length, 2);

    clock.advance(1000);
    relays.hook = null;
    await sync();
    assert.equal(relays.requests.length, 3);
    assert.equal((await relay()).failureCount, 0);
});

test("backoff is capped at one hour", () => {

    assert.equal(SyncEngine.backoffMs(1), 30 * 1000);
    assert.equal(SyncEngine.backoffMs(2), 60 * 1000);
    assert.equal(SyncEngine.backoffMs(8), 60 * 60 * 1000);
    assert.equal(SyncEngine.backoffMs(50), 60 * 60 * 1000);
});

test("disabled relays are not synced", async () => {

    const { relays, sync, storage, relay } = await setup();

    await storage.relaysPut({ ...(await relay()), disabled: true });
    await sync();

    assert.equal(relays.requests.length, 0);
});

test("a user edit during sync is kept, sync fields are written", async () => {

    const { relays, seal, sync, storage, relay } = await setup();

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

test("a relay deleted during sync is not resurrected", async () => {

    const { relays, seal, sync, storage } = await setup();

    relays.add(RELAY_A, await seal("one"));
    relays.add(RELAY_A, await seal("two"));

    relays.hook = async () => {
        await storage.relaysDelete({ relayUrl: RELAY_A });
    };

    await sync();

    assert.deepEqual(await storage.relaysGet(), []);
});

test("the relay event is published only when sync state changed", async () => {

    const { relays, seal, sync, eventsOf } = await setup();

    relays.add(RELAY_A, await seal("hi"));

    await sync();
    assert.equal(eventsOf(EventTypes.RELAY).length, 1);
    assert.equal(eventsOf(EventTypes.RELAY)[0].relay.cursor, 1);

    await sync();
    assert.equal(eventsOf(EventTypes.RELAY).length, 1);
});

// =====================================================
// Rate limit
// =====================================================

test("requests to one relay stay within burst 3 and 2 per second", async () => {

    const { clock, relays, seal, sync, storage } = await setup();

    for (let i = 0; i < 10; i++) {
        relays.add(RELAY_A, await seal(`m${i}`));
    }

    const start = clock.now();
    await sync();

    assert.equal((await storage.envelopesGet()).length, 10);

    // 10 envelopes + the closing 204
    const times = relays.requests.map(r => r.at - start);
    assert.equal(times.length, 11);

    times.forEach((t, i) => {
        assert.ok(t >= Math.max(0, i - 2) * 500, `request ${i} at ${t}ms`);
    });
});

test("relays are rate limited independently", async () => {

    const { clock, relays, seal, sync } = await setup({ relayUrls: [RELAY_A, RELAY_B] });

    for (let i = 0; i < 6; i++) {
        relays.add(RELAY_A, await seal(`a${i}`));
        relays.add(RELAY_B, await seal(`b${i}`));
    }

    const start = clock.now();
    await sync();

    for (const relayUrl of [RELAY_A, RELAY_B]) {
        const times = relays.requestsTo(relayUrl).map(r => r.at - start);
        assert.deepEqual(times.slice(0, 3), [0, 0, 0], relayUrl);
        assert.equal(times.length, 7);
    }
});

test("429 pauses the relay for Retry-After without counting a failure", async () => {

    const { clock, relays, seal, sync, relay, storage } = await setup();

    relays.add(RELAY_A, await seal("hi"));

    relays.hook = () => ({ status: 429, headers: { "retry-after": "30" } });

    await sync();
    assert.equal(relays.requests.length, 1);
    assert.equal((await relay()).failureCount ?? 0, 0);

    relays.hook = null;

    clock.advance(29 * 1000);
    await sync();
    assert.equal(relays.requests.length, 1);

    clock.advance(1000);
    await sync();
    assert.equal((await storage.envelopesGet()).length, 1);
});
