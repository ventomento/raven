import test from "node:test";
import assert from "node:assert/strict";

import { Scheduler } from "../../src/sync/scheduler.js";
import { RelaySession } from "../../src/session/relay-session.js";
import { Ingestor } from "../../src/ingest/ingestor.js";
import { StorageMemory } from "../../src/storage/storage-memory.js";
import { TransportDefault } from "../../src/transport/transport-default.js";
import { LightLog } from "../../src/log/light-log.js";
import { RequestSigner } from "../../src/auth/request-signer.js";
import { identity, envelopeFor, startRelay } from "../helpers/relay-fixtures.js";

// The sync modules wired by hand, the way SmerpClient wires them, against
// the mock relay over HTTP: their contracts fit without the client.

// Upload as the sender, signed (the mock relay requires it).
async function upload(server, relayUrl, sender, envelope) {

    const target = "/envelopes";
    const signer = new RequestSigner({ identity: sender, relayPkh: await server.relayPkh() });

    const response = await fetch(`${relayUrl}${target}`, {
        method: "POST",
        body: envelope.bytes,
        headers: {
            "content-type": "application/octet-stream",
            ...(await signer.headers({ method: "POST", target, body: envelope.bytes })),
        },
    });

    assert.equal(response.status, 200);
}

/**
 * bob's pipeline: one Ingestor, one RelaySession per relay, a Scheduler.
 * Every request and every save is logged.
 */
async function pipeline(relays, { concurrency = 6 } = {}) {

    const bob = await identity();
    const storage = new StorageMemory();
    const logger = new LightLog();
    const requests = [];
    const saved = new Map();     // relayUrl -> last state
    const announced = [];

    const transporter = {
        transport: (request) => {
            requests.push(request);
            return TransportDefault.transport(request);
        },
    };

    const ingestor = new Ingestor({
        identity: bob,
        storage,
        logger,
        onEnvelope: envelope => announced.push(envelope.hash),
    });

    const errors = [];
    const scheduler = new Scheduler({ concurrency, onError: error => errors.push(error) });

    for (const relay of relays) {

        scheduler.add(new RelaySession({
            relay,
            identity: bob,
            transporter,
            logger,
            consume: frames => ingestor.ingest(frames, relay.relayUrl),
            save: async state => { saved.set(relay.relayUrl, state); },
        }));
    }

    return { bob, storage, requests, saved, announced, errors, scheduler, ingestor };
}

test("first contact, one batch for many envelopes, then caught up", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await identity();
    const bob = await pipeline([relay]);

    for (let i = 0; i < 30; i++) {
        await upload(server, relay.relayUrl, alice, await envelopeFor(alice, bob.bob, `m${i}`));
    }

    await bob.scheduler.wake();

    // unsigned 401 teaches the relay key, then one signed batch, then 204
    assert.equal(bob.requests.length, 3);
    assert.equal("x-smerp-signature" in bob.requests[0].options.headers, false);
    assert.equal("x-smerp-signature" in bob.requests[1].options.headers, true);

    assert.equal((await bob.storage.envelopesGet()).length, 30);
    assert.equal(bob.announced.length, 30);
    assert.equal((await bob.storage.conversationsGet())[0].unreadCount, 30);

    const state = bob.saved.get(relay.relayUrl);
    assert.equal(state.cursor, 30);
    assert.equal(state.relayPkh, await server.relayPkh());
    assert.equal(state.failureCount, 0);
    assert.deepEqual(bob.errors, []);
});

test("a session built from the saved state resumes without first contact", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await identity();
    const first = await pipeline([relay]);

    await upload(server, relay.relayUrl, alice, await envelopeFor(alice, first.bob, "one"));
    await first.scheduler.wake();

    // the same identity and storage, a new session from the saved record
    const resumed = { ...relay, ...first.saved.get(relay.relayUrl) };
    const requests = [];

    const session = new RelaySession({
        relay: resumed,
        identity: first.bob,
        transporter: {
            transport: (request) => {
                requests.push(request);
                return TransportDefault.transport(request);
            },
        },
        logger: new LightLog(),
        consume: frames => first.ingestor.ingest(frames, relay.relayUrl),
        save: async () => {},
    });

    await upload(server, relay.relayUrl, alice, await envelopeFor(alice, first.bob, "two"));

    const scheduler = new Scheduler();
    scheduler.add(session);
    await scheduler.wake();

    assert.equal("x-smerp-signature" in requests[0].options.headers, true);
    assert.match(requests[0].url, /cursor=1$/);
    assert.equal((await first.storage.envelopesGet()).length, 2);
    assert.equal(first.announced.length, 2, "the first envelope is not fetched again");
});

test("an envelope on two relays is stored and counted once", async (t) => {

    const one = await startRelay(t);
    const two = await startRelay(t);
    const alice = await identity();
    const bob = await pipeline([one.relay, two.relay]);

    const envelope = await envelopeFor(alice, bob.bob, "hi");
    await upload(one.server, one.relay.relayUrl, alice, envelope);
    await upload(two.server, two.relay.relayUrl, alice, envelope);

    await bob.scheduler.wake();

    assert.deepEqual(bob.announced, [envelope.hash]);
    assert.equal((await bob.storage.conversationsGet())[0].unreadCount, 1);
    assert.equal(bob.saved.get(one.relay.relayUrl).cursor, 1);
    assert.equal(bob.saved.get(two.relay.relayUrl).cursor, 1);
});

test("with concurrency 1, two relays both finish", async (t) => {

    const one = await startRelay(t);
    const two = await startRelay(t);
    const alice = await identity();
    const bob = await pipeline([one.relay, two.relay], { concurrency: 1 });

    await upload(one.server, one.relay.relayUrl, alice, await envelopeFor(alice, bob.bob, "via one"));
    await upload(two.server, two.relay.relayUrl, alice, await envelopeFor(alice, bob.bob, "via two"));

    await bob.scheduler.wake();

    assert.deepEqual(
        (await bob.storage.envelopesGet()).map(e => e.plaintext).sort(),
        ["via one", "via two"]
    );
});
