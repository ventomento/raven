import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../smep/src/index.js";
import { RelaySession, SessionOutcome } from "../src/relay/relay-session.js";
import { RelayRateLimits } from "../src/relay/rate-limits.js";
import { encodeBatch } from "../src/protocol/index.js";
import { LightLog } from "../src/log/light-log.js";
import { VirtualClock, FakeRelays } from "./helpers/fakes.js";

const RELAY = "http://relay.test";
const RELAY_PKH = "ab".repeat(32);

const bytes = (...values) => new Uint8Array(values);

async function setup(relayFields = {}) {

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);
    const changes = [];

    const session = new RelaySession({
        relay: { relayUrl: RELAY, relayType: "archive", ...relayFields },
        identity: await PrivateIdentity.generate(),
        transporter: relays,
        logger: new LightLog(),
        clock,
        bucket: new RelayRateLimits({ clock }).for(RELAY),
        onChange: async (state) => { changes.push(state); },
    });

    // consume that records what it was given
    const consumed = [];
    const consume = async (frames, cursor) => {
        consumed.push({ frames: frames.map(f => Array.from(new Uint8Array(f))), cursor });
    };

    return { clock, relays, session, changes, consumed, consume };
}

// =====================================================
// GET: status handling
// =====================================================

test("204 is EMPTY and a success", async () => {

    const { session, consume, consumed, changes } = await setup({ failureCount: 2 });

    const result = await session.get(consume);

    assert.deepEqual(result, { outcome: SessionOutcome.EMPTY });
    assert.deepEqual(consumed, []);
    assert.equal(session.failureCount, 0);
    assert.equal(changes.at(-1).failureCount, 0);
});

test("a batch is consumed whole, then the cursor advances to the batch cursor", async () => {

    const { relays, session, consume, consumed, changes } = await setup();

    relays.add(RELAY, bytes(1));
    relays.add(RELAY, bytes(2, 2));
    relays.add(RELAY, bytes(3));

    const result = await session.get(consume);

    assert.deepEqual(result, { outcome: SessionOutcome.MORE });
    assert.deepEqual(consumed, [{ frames: [[1], [2, 2], [3]], cursor: 3 }]);
    assert.equal(session.cursor, 3);
    assert.equal(changes.at(-1).cursor, 3);
    assert.equal(relays.requests[0].cursor, 0);
});

test("when consume throws the cursor stays and the relay is not blamed", async () => {

    const { relays, session } = await setup();

    relays.add(RELAY, bytes(1));

    const result = await session.get(async () => { throw new Error("QuotaExceededError"); });

    assert.equal(result.outcome, SessionOutcome.ERROR);
    assert.match(result.error.message, /QuotaExceededError/);
    assert.equal(session.cursor, 0);
    assert.equal(session.failureCount, 0);
});

test("a missing or regressing cursor keeps the cursor and counts a failure", async () => {

    const { relays, session, consume, consumed } = await setup({ cursor: 5 });

    for (const cursor of [undefined, "5", "abc"]) {

        relays.hook = () => ({
            status: 200,
            headers: cursor === undefined ? {} : { "x-smerp-cursor": cursor },
            body: encodeBatch([bytes(1)]),
        });

        const result = await session.get(consume);

        assert.equal(result.outcome, SessionOutcome.FAILURE);
        assert.equal(session.cursor, 5);
    }

    assert.deepEqual(consumed, []);
    assert.equal(session.failureCount, 3);
    assert.match(session.lastFailureReason, /invalid cursor/);
});

test("broken framing with a valid cursor keeps the frames before the break and moves on", async () => {

    const { relays, session, consume, consumed } = await setup();

    const body = encodeBatch([bytes(1), bytes(2, 2)]);

    relays.hook = () => ({
        status: 200,
        headers: { "x-smerp-cursor": "2" },
        body: body.subarray(0, body.byteLength - 1),
    });

    const result = await session.get(consume);

    assert.equal(result.outcome, SessionOutcome.MORE);
    assert.match(result.error.message, /past the end/);
    assert.deepEqual(consumed, [{ frames: [[1]], cursor: 2 }]);
    assert.equal(session.cursor, 2);
    assert.equal(session.failureCount, 1);
});

test("a non-binary 200 body is skipped past and counts against the relay", async () => {

    const { relays, session, consume, consumed } = await setup();

    relays.hook = () => ({
        status: 200,
        headers: { "x-smerp-cursor": "1" },
        body: "<html>oops</html>",
    });

    const result = await session.get(consume);

    assert.equal(result.outcome, SessionOutcome.MORE);
    assert.deepEqual(consumed, [{ frames: [], cursor: 1 }]);
    assert.equal(session.cursor, 1);
    assert.equal(session.lastFailureReason, "relay returned a non-binary body");
});

test("401 is a failure carrying the relay's reason", async () => {

    const { relays, session, consume } = await setup();

    relays.hook = () => ({
        status: 401,
        headers: { "x-smerp-unauthorized": "token expired" },
    });

    const result = await session.get(consume);

    assert.equal(result.outcome, SessionOutcome.FAILURE);
    assert.match(result.error.message, /unauthorized/);
    assert.equal(session.lastFailureReason, "unauthorized: token expired");
});

test("429 pauses the bucket for Retry-After without counting a failure", async () => {

    const { clock, relays, session, consume } = await setup();

    relays.hook = () => ({ status: 429, headers: { "retry-after": "30" } });

    const result = await session.get(consume);

    assert.deepEqual(result, { outcome: SessionOutcome.THROTTLED });
    assert.equal(session.failureCount, 0);
    assert.equal(session.isThrottled(), true);
    assert.equal(session.notBefore(), clock.now() + 30 * 1000);
});

test("unsupported statuses and network errors are failures", async () => {

    const { relays, session, consume } = await setup();

    relays.hook = () => ({ status: 500 });
    assert.equal((await session.get(consume)).outcome, SessionOutcome.FAILURE);
    assert.equal(session.lastFailureReason, "unsupported response status 500");

    relays.hook = () => { throw new Error("ECONNREFUSED"); };
    assert.equal((await session.get(consume)).outcome, SessionOutcome.FAILURE);
    assert.equal(session.lastFailureReason, "ECONNREFUSED");
    assert.equal(session.failureCount, 2);
});

// =====================================================
// Timing
// =====================================================

test("failures back off exponentially, capped at one hour", async () => {

    const { clock, relays, session, consume } = await setup();

    relays.hook = () => { throw new Error("ECONNREFUSED"); };

    await session.get(consume);
    assert.equal(session.backoffUntil(), clock.now() + 30 * 1000);
    assert.equal(session.notBefore(), clock.now() + 30 * 1000);

    await session.get(consume);
    assert.equal(session.backoffUntil(), clock.now() + 60 * 1000);

    assert.equal(RelaySession.backoffMs(8), 60 * 60 * 1000);
    assert.equal(RelaySession.backoffMs(50), 60 * 60 * 1000);
});

test("notBefore waits for a token once the burst is spent", async () => {

    const { clock, session } = await setup();

    for (let i = 0; i < 3; i++) {
        assert.equal(session.bucket.tryTake(), true);
    }

    assert.equal(session.notBefore(), clock.now() + 500);
});

// =====================================================
// Exchange: relay key and token
// =====================================================

test("an unsigned request answered by 401 with the relay pkh is retried signed once", async () => {

    const { relays, session, consume, changes } = await setup();

    relays.hook = (request) => request.signed
        ? null
        : { status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } };

    const result = await session.get(consume);

    assert.equal(result.outcome, SessionOutcome.EMPTY);
    assert.deepEqual(relays.requests.map(r => r.signed), [false, true]);
    assert.equal(session.relayPkh, RELAY_PKH);
    assert.equal(changes[0].relayPkh, RELAY_PKH);
    assert.equal(session.failureCount, 0);
});

test("a rotated relay pkh is adopted from a 401 and retried once", async () => {

    const { relays, session, consume } = await setup({ relayPkh: "cd".repeat(32) });

    let calls = 0;
    relays.hook = () => calls++ === 0
        ? { status: 401, headers: { "x-smerp-relay-pkh": `0x${RELAY_PKH.toUpperCase()}` } }
        : { status: 204, headers: { "x-smerp-relay-pkh": RELAY_PKH } };

    await session.get(consume);

    assert.equal(relays.requests.length, 2);
    assert.equal(session.relayPkh, RELAY_PKH);
    assert.equal(session.failureCount, 0);
});

test("a 401 carrying the pkh it was signed with is not retried", async () => {

    const { relays, session, consume } = await setup({ relayPkh: RELAY_PKH });

    relays.hook = () => ({ status: 401, headers: { "x-smerp-relay-pkh": RELAY_PKH } });

    await session.get(consume);

    assert.equal(relays.requests.length, 1);
    assert.equal(session.failureCount, 1);
});

test("a missing or malformed relay pkh header keeps the known pkh", async () => {

    const { relays, session, consume } = await setup({ relayPkh: RELAY_PKH });

    let calls = 0;
    relays.hook = () => calls++ === 0
        ? { status: 204, headers: { "x-smerp-relay-pkh": "zz" } }
        : { status: 204, headers: {} };

    await session.get(consume);
    await session.get(consume);

    assert.equal(session.relayPkh, RELAY_PKH);
});

test("the access token is sent as a bearer token and follows configure", async () => {

    const { relays, session, consume } = await setup({ relayToken: "t1" });

    await session.get(consume);
    session.configure({ relayUrl: RELAY, relayToken: "t2" });
    await session.get(consume);
    session.configure({ relayUrl: RELAY });
    await session.get(consume);

    assert.deepEqual(
        relays.requests.map(r => r.authorization),
        ["Bearer t1", "Bearer t2", undefined]
    );
});

// =====================================================
// POST
// =====================================================

test("post resolves on 200 and leaves relay health alone", async () => {

    const { relays, session } = await setup({ failureCount: 1 });

    await session.post(bytes(1));

    assert.equal(relays.requests[0].method, "POST");
    assert.equal(session.failureCount, 1);
});

test("post on 429 pauses the relay and throws", async () => {

    const { relays, session } = await setup();

    relays.hook = () => ({ status: 429, headers: { "retry-after": "60" } });

    await assert.rejects(session.post(bytes(1)), /asked to wait/);
    assert.equal(session.isThrottled(), true);
});

test("post on any other status throws with the relay's reason", async () => {

    const { relays, session } = await setup();

    relays.hook = () => ({ status: 401, headers: { "x-smerp-unauthorized": "no token" } });
    await assert.rejects(session.post(bytes(1)), /401 \(no token\)/);

    relays.hook = () => ({ status: 400 });
    await assert.rejects(session.post(bytes(1)), /dispatch failed: 400/);

    assert.equal(session.failureCount, 0);
});
