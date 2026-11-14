import test from "node:test";
import assert from "node:assert/strict";

import { notifyTopic } from "../../../smep/src/internal.js";
import { NtfyNotifier } from "../../src/notify/ntfy-notifier.js";
import { VirtualClock, FakeRelays } from "../helpers/fakes.js";
import { identity, RecordingLogger } from "../helpers/relay-fixtures.js";

const NTFY = "http://ntfy.test";
const WINDOW = 3 * 60 * 1000;

// A push awaits WebCrypto, so tests wait for it to reach the transport (or, for
// "no push", give it ample time not to).
async function pushed(relays, count) {

    for (let i = 0; i < 500 && relays.requests.length < count; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }

    await settle();

    assert.equal(relays.requests.length, count);
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 20));
}

async function startNotifier(t, options = {}) {

    const clock = new VirtualClock();
    const relays = new FakeRelays(clock);
    const me = await identity();
    const bob = await identity();

    const notifier = new NtfyNotifier({ identity: me, transporter: relays, ntfyUrl: NTFY, clock, ...options });

    t.after(() => notifier.stop());

    const bodies = () => relays.requests.map(r => r.body);

    return { notifier, clock, relays, me, bob, peer: bob.publicKeyHex, bodies };
}

test("the first message pushes at once, to the pair's topic", async (t) => {

    const { notifier, relays, me, bob, peer } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);

    const [push] = relays.requests;

    assert.equal(push.method, "POST");
    assert.equal(push.url, `${NTFY}/${await notifyTopic(bob, me.publicKeyHex, bob.publicKeyHex)}`);
    assert.deepEqual(push.headers, { "Title": "raven", "X-Sequence-ID": "raven" });
    assert.equal(push.body, "New message");
});

test("messages during a window push once when it ends, with the burst's total", async (t) => {

    const { notifier, clock, relays, peer, bodies } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);

    notifier.messageSent(peer);
    notifier.messageSent(peer);
    clock.advance(WINDOW - 1);
    await pushed(relays, 1);

    clock.advance(1);
    await pushed(relays, 2);

    assert.deepEqual(bodies(), ["New message", "3 new messages"]);
});

test("the total keeps growing across windows while the burst lasts", async (t) => {

    const { notifier, clock, relays, peer, bodies } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);
    notifier.messageSent(peer);
    clock.advance(WINDOW);
    await pushed(relays, 2);

    notifier.messageSent(peer);
    clock.advance(WINDOW);
    await pushed(relays, 3);

    assert.deepEqual(bodies(), ["New message", "2 new messages", "3 new messages"]);
});

test("a flush opens a new window, so the next message doesn't push at once", async (t) => {

    const { notifier, clock, relays, peer } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);
    notifier.messageSent(peer);
    clock.advance(WINDOW);
    await pushed(relays, 2);

    notifier.messageSent(peer);
    await pushed(relays, 2);
});

test("a window with nothing counted ends the burst and drops the peer's state", async (t) => {

    const { notifier, clock, relays, peer, bodies } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);

    clock.advance(WINDOW);
    await pushed(relays, 1);
    assert.equal(notifier.peers.size, 0);
    assert.equal(clock.alarms.length, 0);

    notifier.messageSent(peer);
    await pushed(relays, 2);

    assert.deepEqual(bodies(), ["New message", "New message"]);
});

test("a burst that goes on and then stops leaves nothing behind", async (t) => {

    const { notifier, clock, relays, peer } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);
    notifier.messageSent(peer);
    clock.advance(WINDOW);
    await pushed(relays, 2);

    clock.advance(WINDOW);
    await pushed(relays, 2);

    assert.equal(notifier.peers.size, 0);
    assert.equal(clock.alarms.length, 0);
});

test("peers batch independently, and a peer's case doesn't split its burst", async (t) => {

    const { notifier, relays, peer } = await startNotifier(t);
    const carol = await identity();

    notifier.messageSent(peer);
    notifier.messageSent(peer.toUpperCase());
    notifier.messageSent(carol.publicKeyHex);
    await pushed(relays, 2);

    assert.equal(notifier.peers.get(peer).total, 2);
    assert.equal(new Set(relays.requests.map(r => r.url)).size, 2);
});

test("a failed push isn't retried; its message stays in the burst's next total", async (t) => {

    for (const answer of [() => ({ status: 500 }), () => { throw new Error("offline"); }]) {

        const { notifier, clock, relays, peer, bodies } = await startNotifier(t);

        relays.hook = answer;
        notifier.messageSent(peer);
        await pushed(relays, 1);

        relays.hook = null;
        notifier.messageSent(peer);
        clock.advance(WINDOW);
        await pushed(relays, 2);

        assert.deepEqual(bodies(), ["New message", "2 new messages"]);
    }
});

test("a failed push with nothing after it is not retried", async (t) => {

    const { notifier, clock, relays, peer } = await startNotifier(t);

    relays.hook = () => ({ status: 500 });
    notifier.messageSent(peer);
    await pushed(relays, 1);

    clock.advance(WINDOW);
    await pushed(relays, 1);
    assert.equal(notifier.peers.size, 0);
});

test("a 429 pauses every peer for its Retry-After, then what was counted goes out", async (t) => {

    const { notifier, clock, relays, peer, bodies } = await startNotifier(t);
    const carol = await identity();

    relays.hook = () => ({ status: 429, headers: { "retry-after": "600" } });
    notifier.messageSent(peer);
    await pushed(relays, 1);

    relays.hook = null;
    notifier.messageSent(carol.publicKeyHex);
    await pushed(relays, 1);

    clock.advance(WINDOW);
    await pushed(relays, 1);

    clock.advance(600 * 1000 - WINDOW);
    await pushed(relays, 3);

    assert.deepEqual(bodies(), ["New message", "New message", "New message"]);
});

test("a 429 with an invalid Retry-After pauses for the default", async (t) => {

    const { notifier, clock, relays, peer } = await startNotifier(t);

    relays.hook = () => ({ status: 429, headers: { "retry-after": "1e9" } });
    notifier.messageSent(peer);
    await pushed(relays, 1);

    assert.equal(notifier.pausedUntil, clock.now() + 60 * 1000);
});

test("stop flushes what was counted, cancels the windows and ignores later messages", async (t) => {

    const { notifier, clock, relays, peer, bodies } = await startNotifier(t);

    notifier.messageSent(peer);
    await pushed(relays, 1);
    notifier.messageSent(peer);

    notifier.stop();
    await pushed(relays, 2);
    assert.deepEqual(bodies(), ["New message", "2 new messages"]);
    assert.equal(clock.alarms.length, 0);

    notifier.messageSent(peer);
    clock.advance(WINDOW);
    await pushed(relays, 2);
});

test("stop with nothing counted, or during a pause, pushes nothing", async (t) => {

    const quiet = await startNotifier(t);

    quiet.notifier.messageSent(quiet.peer);
    await pushed(quiet.relays, 1);
    quiet.notifier.stop();
    await pushed(quiet.relays, 1);

    const paused = await startNotifier(t);

    paused.relays.hook = () => ({ status: 429, headers: { "retry-after": "600" } });
    paused.notifier.messageSent(paused.peer);
    await pushed(paused.relays, 1);
    paused.notifier.stop();
    await pushed(paused.relays, 1);
});

test("the window is an option, 3 minutes by default", async (t) => {

    assert.equal(NtfyNotifier.DEFAULTS.windowMs, WINDOW);

    const { notifier, clock, relays, peer } = await startNotifier(t, { windowMs: 1000 });

    notifier.messageSent(peer);
    await pushed(relays, 1);
    notifier.messageSent(peer);
    clock.advance(1000);
    await pushed(relays, 2);
});

test("options are checked, ntfyUrl loses trailing slashes", async () => {

    const id = await identity();
    const transporter = new FakeRelays(new VirtualClock());

    assert.equal(new NtfyNotifier({ identity: id, transporter }).ntfyUrl, "https://ntfy.sh");
    assert.equal(new NtfyNotifier({ identity: id, transporter, ntfyUrl: "http://localhost:81//" }).ntfyUrl, "http://localhost:81");

    for (const options of [
        { identity: null },
        { transporter: null },
        { windowMs: "soon" },
        { ntfyUrl: 42 },
        { ntfyUrl: "not a url" },
        { ntfyUrl: "ftp://ntfy.test" },
    ]) {
        assert.throws(() => new NtfyNotifier({ identity: id, transporter, ...options }), JSON.stringify(options));
    }
});

test("the topic never reaches the log", async (t) => {

    const entries = [];
    const { notifier, relays, me, bob, peer } = await startNotifier(t, { logger: new RecordingLogger({ entries }) });

    relays.hook = () => ({ status: 500 });
    notifier.messageSent(peer);
    await pushed(relays, 1);

    const topic = await notifyTopic(bob, me.publicKeyHex, bob.publicKeyHex);

    assert.ok(entries.some(([, message]) => message === "ntfy push refused"));
    assert.ok(!JSON.stringify(entries).includes(topic));
});
