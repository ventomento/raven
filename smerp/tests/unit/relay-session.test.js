import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../../smep/src/index.js";
import { RelaySession } from "../../src/session/relay-session.js";
import { encodeBatch } from "../../src/protocol/index.js";
import { VirtualClock } from "../helpers/fakes.js";
import { RecordingLogger } from "../helpers/relay-fixtures.js";

const RELAY_URL = "http://relay.test";
const RELAY_PKH = "ab".repeat(32);
const OTHER_PKH = "cd".repeat(32);

const bytes = (...values) => new Uint8Array(values);
const asArrays = (frames) => frames.map(frame => Array.from(new Uint8Array(frame)));

const batch = (cursor, frames, headers = {}) => ({
    status: 200,
    headers: { "x-smerp-cursor": String(cursor), ...headers },
    body: encodeBatch(frames),
});
const noContent = (headers = {}) => ({ status: 204, headers, body: new Uint8Array(0) });
const status = (code, headers = {}) => ({ status: code, headers, body: new Uint8Array(0) });

async function setup({ relay = {}, respond = () => noContent(), consume, save } = {}) {

    const clock = new VirtualClock();
    const logger = new RecordingLogger();

    const ctx = {
        clock,
        logger,
        respond,
        requests: [],
        consumed: [],
        saved: [],
    };

    ctx.session = new RelaySession({
        relay: { relayUrl: RELAY_URL, ...relay },
        identity: await PrivateIdentity.generate(),
        transporter: {
            transport: async (request) => {
                ctx.requests.push(request);
                return ctx.respond(request);
            },
        },
        consume: consume ?? (async frames => { ctx.consumed.push(frames); }),
        save: save ?? (async state => { ctx.saved.push(state); }),
        logger,
        clock,
    });

    return ctx;
}

const signed = (request) => "x-smerp-signature" in request.options.headers;

const failedLongAgo = (clock, failureCount = 2) => ({
    failureCount,
    lastFailureAt: clock.now() - 2 * 60 * 60 * 1000,
    lastFailureReason: "old",
});

test("200: consumes the frames, then advances the cursor, records success, saves", async () => {

    const ctx = await setup({ respond: () => batch(5, [bytes(1), bytes(2, 3)]) });

    let cursorWhileConsuming;
    ctx.session.consume = async frames => {
        cursorWhileConsuming = ctx.session.cursor;
        ctx.consumed.push(frames);
    };

    assert.equal(await ctx.session.step(), true);

    assert.equal(ctx.requests[0].url, `${RELAY_URL}/envelopes?cursor=0`);
    assert.deepEqual(ctx.consumed.map(asArrays), [[[1], [2, 3]]]);
    assert.equal(cursorWhileConsuming, 0);
    assert.equal(ctx.session.cursor, 5);
    assert.equal(ctx.session.failureCount, 0);
    assert.equal(ctx.session.lastSuccessAt, ctx.clock.now());
    assert.deepEqual(ctx.saved, [ctx.session.state()]);

    await ctx.session.step();
    assert.equal(ctx.requests[1].url, `${RELAY_URL}/envelopes?cursor=5`);
});

test("204: caught up, success, cursor unchanged", async () => {

    const clock = new VirtualClock();
    const ctx = await setup({ relay: { cursor: 4, ...failedLongAgo(clock) } });

    assert.equal(await ctx.session.step(), false);

    assert.equal(ctx.session.cursor, 4);
    assert.equal(ctx.session.failureCount, 0);
    assert.equal(ctx.session.lastFailureReason, null);
    assert.deepEqual(ctx.consumed, []);
    assert.equal(ctx.saved.length, 1);
});

test("broken framing with a valid cursor: frames before the break are consumed and the cursor moves", async () => {

    const ctx = await setup({
        respond: () => {
            const body = encodeBatch([bytes(1), bytes(2, 3)]);
            return { status: 200, headers: { "x-smerp-cursor": "9" }, body: body.subarray(0, body.byteLength - 1) };
        },
    });

    assert.equal(await ctx.session.step(), false);

    assert.deepEqual(ctx.consumed.map(asArrays), [[[1]]]);
    assert.equal(ctx.session.cursor, 9);
    assert.equal(ctx.session.failureCount, 1);
    assert.match(ctx.session.lastFailureReason, /past the end/);
});

test("a body that is not bytes is a failure", async () => {

    const ctx = await setup({
        respond: () => ({ status: 200, headers: { "x-smerp-cursor": "3" }, body: "<html>" }),
    });

    assert.equal(await ctx.session.step(), false);

    assert.equal(ctx.session.failureCount, 1);
    assert.match(ctx.session.lastFailureReason, /non-binary/);
});

test("a missing or regressing cursor is a failure: nothing consumed, cursor kept", async () => {

    for (const [headers, reason] of [
        [{}, /invalid cursor/],
        [{ "x-smerp-cursor": "abc" }, /invalid cursor/],
        [{ "x-smerp-cursor": "4" }, /cursor regression/],
        [{ "x-smerp-cursor": "2" }, /cursor regression/],
    ]) {

        const ctx = await setup({
            relay: { cursor: 4 },
            respond: () => ({ status: 200, headers, body: encodeBatch([bytes(1)]) }),
        });

        assert.equal(await ctx.session.step(), false);

        assert.deepEqual(ctx.consumed, []);
        assert.equal(ctx.session.cursor, 4);
        assert.equal(ctx.session.failureCount, 1);
        assert.match(ctx.session.lastFailureReason, reason);
    }
});

test("401 that teaches a new relay key: success, more to do, next request signed with it", async () => {

    const ctx = await setup({
        respond: (request) => signed(request)
            ? noContent({ "x-smerp-relay-pkh": RELAY_PKH })
            : status(401, { "x-smerp-relay-pkh": RELAY_PKH }),
    });

    assert.equal(await ctx.session.step(), true);

    assert.equal(signed(ctx.requests[0]), false);
    assert.equal(ctx.session.relayPkh, RELAY_PKH);
    assert.equal(ctx.session.failureCount, 0);
    assert.equal(ctx.saved.at(-1).relayPkh, RELAY_PKH);

    assert.equal(await ctx.session.step(), false);
    assert.equal(signed(ctx.requests[1]), true);
});

test("401 with the known key is a failure carrying the relay's reason", async () => {

    const withReason = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => status(401, { "x-smerp-relay-pkh": RELAY_PKH, "x-smerp-unauthorized": "expired" }),
    });

    assert.equal(await withReason.session.step(), false);
    assert.equal(withReason.session.failureCount, 1);
    assert.equal(withReason.session.lastFailureReason, "unauthorized: expired");

    const without = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => status(401),
    });

    assert.equal(await without.session.step(), false);
    assert.equal(without.session.lastFailureReason, "unauthorized");
    assert.equal(without.session.relayPkh, RELAY_PKH);
});

test("a malformed relay key header is ignored with a warning", async () => {

    const ctx = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => noContent({ "x-smerp-relay-pkh": "not-a-key" }),
    });

    await ctx.session.step();

    assert.equal(ctx.session.relayPkh, RELAY_PKH);
    assert.ok(ctx.logger.warnings().some(message => /invalid relay pkh/.test(message)));
});

test("a relay key in 0x or uppercase form is normalized; a changed one is adopted", async () => {

    const ctx = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => noContent({ "x-smerp-relay-pkh": `0x${OTHER_PKH.toUpperCase()}` }),
    });

    await ctx.session.step();

    assert.equal(ctx.session.relayPkh, OTHER_PKH);
});

test("429: pauses for Retry-After seconds without touching health", async () => {

    const ctx = await setup({ respond: () => status(429, { "retry-after": "60" }) });

    assert.equal(await ctx.session.step(), false);
    assert.equal(ctx.session.pausedUntil, ctx.clock.now() + 60 * 1000);
    assert.equal(ctx.session.failureCount, 0);

    ctx.respond = () => noContent();

    ctx.clock.advance(59 * 1000);
    assert.equal(await ctx.session.step(), false);
    assert.equal(ctx.requests.length, 1, "no request while paused");

    ctx.clock.advance(1000);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 2);
});

test("429 without a readable Retry-After waits 5 s", async () => {

    for (const headers of [{}, { "retry-after": "soon" }, { "retry-after": "-3" }]) {

        const ctx = await setup({ respond: () => status(429, headers) });

        await ctx.session.step();

        assert.equal(ctx.session.pausedUntil, ctx.clock.now() + 5000, JSON.stringify(headers));
    }
});

test("an unexpected status and a transport error are failures", async () => {

    const server = await setup({ respond: () => status(500) });
    assert.equal(await server.session.step(), false);
    assert.equal(server.session.lastFailureReason, "unexpected status 500");
    assert.equal(server.saved.at(-1).failureCount, 1);

    const network = await setup({ respond: () => { throw new Error("ECONNREFUSED"); } });
    assert.equal(await network.session.step(), false);
    assert.equal(network.session.lastFailureReason, "ECONNREFUSED");
    assert.equal(network.session.lastFailureAt, network.clock.now());
    assert.equal(network.saved.at(-1).failureCount, 1);
});

test("backoff doubles from 30 s and is capped at 1 h", () => {

    const minutes = (n) => n * 60 * 1000;

    assert.equal(RelaySession.backoffMs(1), 30 * 1000);
    assert.equal(RelaySession.backoffMs(2), minutes(1));
    assert.equal(RelaySession.backoffMs(3), minutes(2));
    assert.equal(RelaySession.backoffMs(8), minutes(60));
    assert.equal(RelaySession.backoffMs(50), minutes(60));
});

test("while backing off, step declines without a request", async () => {

    const ctx = await setup({ respond: () => status(500) });

    await ctx.session.step();

    ctx.clock.advance(30 * 1000 - 1);
    assert.equal(await ctx.session.step(), false);
    assert.equal(ctx.requests.length, 1);

    ctx.clock.advance(1);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 2);
    assert.equal(ctx.session.failureCount, 2);

    ctx.clock.advance(60 * 1000 - 1);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 2);

    ctx.respond = () => noContent();
    ctx.clock.advance(1);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 3);

    assert.equal(ctx.session.failureCount, 0);
    assert.equal(ctx.session.lastFailureReason, null);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 4);
});

test("burst of 3, then step returns true without a request until notBefore", async () => {

    const ctx = await setup();

    assert.equal(ctx.session.notBefore(), ctx.clock.now());

    for (let i = 0; i < 3; i++) {
        await ctx.session.step();
    }

    assert.equal(ctx.requests.length, 3);

    assert.equal(await ctx.session.step(), true, "no token: ask again later");
    assert.equal(ctx.requests.length, 3);
    assert.equal(ctx.saved.length, 3, "nothing to save without a request");

    assert.equal(ctx.session.notBefore(), ctx.clock.now() + 500);

    ctx.clock.advance(500);
    await ctx.session.step();
    assert.equal(ctx.requests.length, 4);
});

test("notBefore holds neither backoff nor a 429 pause", async () => {

    const failing = await setup({ respond: () => status(500) });
    await failing.session.step();
    assert.equal(failing.session.notBefore(), failing.clock.now());

    const paused = await setup({ respond: () => status(429, { "retry-after": "3600" }) });
    await paused.session.step();
    assert.equal(paused.session.notBefore(), paused.clock.now());
});

test("consume throwing rejects the step: cursor kept, relay not blamed, nothing saved", async () => {

    const fault = new Error("disk full");
    const ctx = await setup({
        respond: () => batch(5, [bytes(1)]),
        consume: async () => { throw fault; },
    });

    await assert.rejects(ctx.session.step(), fault);

    assert.equal(ctx.session.cursor, 0);
    assert.equal(ctx.session.failureCount, 0);
    assert.deepEqual(ctx.saved, []);
});

test("save throwing rejects the step", async () => {

    const fault = new Error("disk full");
    const ctx = await setup({ save: async () => { throw fault; } });

    await assert.rejects(ctx.session.step(), fault);
});

test("state is restored from the stored relay record, and the token is sent", async () => {

    const clock = new VirtualClock();
    const stored = {
        cursor: 17,
        relayPkh: RELAY_PKH,
        ...failedLongAgo(clock, 3),
        lastSuccessAt: 12,
    };

    const ctx = await setup({ relay: { ...stored, relayType: "archive", relayToken: "secret" } });

    assert.deepEqual(ctx.session.state(), stored);

    await ctx.session.step();

    const [request] = ctx.requests;
    assert.equal(request.url, `${RELAY_URL}/envelopes?cursor=17`);
    assert.equal(request.options.headers.authorization, "Bearer secret");
    assert.equal(signed(request), true);
});

test("a new relay record starts at cursor 0 with no key and clean health", async () => {

    const ctx = await setup();

    assert.deepEqual(ctx.session.state(), {
        cursor: 0,
        relayPkh: null,
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: null,
    });
});

test("the constructor insists on its dependencies", async () => {

    const ok = {
        relay: { relayUrl: RELAY_URL },
        identity: await PrivateIdentity.generate(),
        transporter: { transport: async () => noContent() },
        consume: async () => {},
        save: async () => {},
        logger: new RecordingLogger(),
    };

    assert.doesNotThrow(() => new RelaySession(ok));

    for (const broken of [
        { relay: {} },
        { consume: null },
        { save: "save" },
        { logger: undefined },
        { identity: {} },
    ]) {
        assert.throws(() => new RelaySession({ ...ok, ...broken }), Object.keys(broken)[0]);
    }
});

test("post: 200 resolves, takes no token, leaves health and storage alone", async () => {

    const ctx = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => status(200, { "x-smerp-relay-pkh": RELAY_PKH }),
    });

    for (let i = 0; i < 5; i++) {
        await ctx.session.post(bytes(i));
    }

    const request = ctx.requests[0];
    assert.equal(request.options.method, "POST");
    assert.equal(request.url, `${RELAY_URL}/envelopes`);
    assert.deepEqual(request.options.body, bytes(0));
    assert.equal(signed(request), true);

    assert.equal(ctx.session.bucket.tokens, 3, "the sync budget is untouched");
    assert.equal(ctx.session.lastSuccessAt, null);
    assert.deepEqual(ctx.saved, []);
});

test("post: a refusal does not count against health", async () => {

    const ctx = await setup({ respond: () => status(400) });

    await assert.rejects(ctx.session.post(bytes(1)), /Relay dispatch failed: 400/);

    assert.equal(ctx.session.failureCount, 0);
});

test("post: 429 pauses the relay, later posts and steps wait", async () => {

    const ctx = await setup({ respond: () => status(429, { "retry-after": "60" }) });

    await assert.rejects(ctx.session.post(bytes(1)), /asked to wait/);
    assert.equal(ctx.session.pausedUntil, ctx.clock.now() + 60 * 1000);

    await assert.rejects(ctx.session.post(bytes(2)), /asked to wait/);
    assert.equal(await ctx.session.step(), false);
    assert.equal(ctx.requests.length, 1, "nothing sent while paused");

    ctx.clock.advance(60 * 1000);
    ctx.respond = () => status(200);
    await ctx.session.post(bytes(3));
    assert.equal(ctx.requests.length, 2);
});

test("post: a 401 that teaches a key saves it and asks to send again", async () => {

    const ctx = await setup({
        respond: (request) => signed(request)
            ? status(200)
            : status(401, { "x-smerp-relay-pkh": RELAY_PKH }),
    });

    await assert.rejects(ctx.session.post(bytes(1)), /401.*relay key learned, send again/);

    assert.equal(ctx.session.relayPkh, RELAY_PKH);
    assert.equal(ctx.saved.at(-1).relayPkh, RELAY_PKH);

    await ctx.session.post(bytes(1));
    assert.equal(signed(ctx.requests[1]), true);
});

test("post: a 401 reports the relay's reason", async () => {

    const ctx = await setup({
        relay: { relayPkh: RELAY_PKH },
        respond: () => status(401, { "x-smerp-unauthorized": "subscription expired" }),
    });

    await assert.rejects(ctx.session.post(bytes(1)), /401 \(subscription expired\)/);
    assert.deepEqual(ctx.saved, [], "no new key, nothing to save");
});

test("post: a transport error propagates", async () => {

    const ctx = await setup({ respond: () => { throw new Error("ECONNREFUSED"); } });

    await assert.rejects(ctx.session.post(bytes(1)), /ECONNREFUSED/);
    assert.equal(ctx.session.failureCount, 0);
});
