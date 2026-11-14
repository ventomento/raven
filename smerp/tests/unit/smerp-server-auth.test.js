import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../../smep/src/internal.js";
import { RequestSigner } from "../helpers/request-signer.js";
import { SmerpServer } from "../server/index.js";

async function startServer(t, options) {

    const server = new SmerpServer(options);
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return {
        server,
        base: `http://127.0.0.1:${server.server.address().port}`,
    };
}

async function signedFetch(server, base, identity, { method = "GET", target, body }) {

    const signer = new RequestSigner({ identity, relayPkh: await server.relayPkh() });

    return fetch(`${base}${await signer.target({ method, target, body })}`, { method, body });
}

function post(server, base, identity, envelope) {

    return signedFetch(server, base, identity, {
        method: "POST",
        target: "/envelopes",
        body: envelope,
    });
}

function get(server, base, identity, cursor = 0) {
    return signedFetch(server, base, identity, { target: `/envelopes?cursor=${cursor}` });
}

async function envelopeFrom(sender, recipient) {

    return encrypt({
        sender,
        recipient: new PublicIdentity(recipient.publicKey),
        plaintext: "hi",
    });
}

test("a signed GET succeeds", async (t) => {

    const { server, base } = await startServer(t);

    const res = await get(server, base, await PrivateIdentity.generate());

    assert.equal(res.status, 204);
});

test("GET serves the signer's mailbox", async (t) => {

    const { server, base } = await startServer(t);
    const [alice, bob, carol] = await Promise.all([1, 2, 3].map(() => PrivateIdentity.generate()));

    assert.equal((await post(server, base, alice, await envelopeFrom(alice, bob))).status, 200);

    assert.equal((await get(server, base, alice)).status, 200);
    assert.equal((await get(server, base, bob)).status, 200);
    assert.equal((await get(server, base, carol)).status, 204);
});

test("unsigned GET and POST are rejected with 401 and the relay pkh", async (t) => {

    const { server, base } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const responses = [
        await fetch(`${base}/envelopes?cursor=0`),
        await fetch(`${base}/envelopes`, {
            method: "POST",
            body: await envelopeFrom(alice, bob),
        }),
    ];

    for (const res of responses) {
        assert.equal(res.status, 401);
        assert.equal(res.headers.get("x-smerp-unauthorized"), "missing signature");
        assert.equal(res.headers.get("x-smerp-relay-pkh"), await server.relayPkh());
    }
});

test("a GET signed for another cursor is rejected", async (t) => {

    const { server, base } = await startServer(t);
    const identity = await PrivateIdentity.generate();

    const signer = new RequestSigner({ identity, relayPkh: await server.relayPkh() });
    const target = await signer.target({ method: "GET", target: "/envelopes?cursor=0" });

    const res = await fetch(`${base}${target.replace("cursor=0", "cursor=5")}`);

    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-smerp-unauthorized"), "invalid signature");
});

test("a POST signed by neither sender nor recipient is rejected", async (t) => {

    const { server, base } = await startServer(t);
    const [alice, bob, mallory] = await Promise.all([1, 2, 3].map(() => PrivateIdentity.generate()));

    const envelope = await envelopeFrom(alice, bob);

    const res = await post(server, base, mallory, envelope);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-smerp-unauthorized"), "signer is neither sender nor recipient");

    assert.equal((await post(server, base, bob, envelope)).status, 200);
});

test("every response carries the relay pkh and the two CORS headers, and rotateKey changes the pkh", async (t) => {

    const { server, base } = await startServer(t);
    const relayPkh = await server.relayPkh();

    assert.match(relayPkh, /^[0-9a-f]{64}$/);

    for (const path of ["/", "/nope", "/envelopes?cursor=0"]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.headers.get("x-smerp-relay-pkh"), relayPkh, path);
        assert.equal(res.headers.get("access-control-allow-origin"), "*", path);
        assert.equal(res.headers.get("access-control-expose-headers"), "*", path);
        assert.equal(res.headers.get("access-control-allow-headers"), null, path);
        assert.equal(res.headers.get("access-control-allow-methods"), null, path);
        assert.equal(res.headers.get("cache-control"), null, path);
    }

    const rotated = await server.rotateKey();
    assert.notEqual(rotated, relayPkh);

    const res = await fetch(base);
    assert.equal(res.headers.get("x-smerp-relay-pkh"), rotated);
});

test("a signature made for the old key is rejected after rotateKey", async (t) => {

    const { server, base } = await startServer(t);
    const identity = await PrivateIdentity.generate();

    const signer = new RequestSigner({ identity, relayPkh: await server.relayPkh() });
    const target = await signer.target({ method: "GET", target: "/envelopes?cursor=0" });

    await server.rotateKey();

    const res = await fetch(`${base}${target}`);

    assert.equal(res.status, 401);
});

test("a POST needs no Content-Type, and any is ignored", async (t) => {

    const { server, base } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));
    const signer = new RequestSigner({ identity: alice, relayPkh: await server.relayPkh() });

    for (const headers of [{}, { "content-type": "text/plain" }]) {

        const body = await envelopeFrom(alice, bob);
        const target = await signer.target({ method: "POST", target: "/envelopes", body });

        assert.equal((await fetch(`${base}${target}`, { method: "POST", body, headers })).status, 200);
    }
});

test("there is no OPTIONS route", async (t) => {

    const { base } = await startServer(t);

    assert.equal((await fetch(`${base}/envelopes`, { method: "OPTIONS" })).status, 404);
});

test("an upload is timed from its arrival: a body that takes long does not expire it", async (t) => {

    let now = Date.now();
    const { server, base } = await startServer(t, { clock: { now: () => now } });
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const signer = new RequestSigner({ identity: alice, relayPkh: await server.relayPkh(), clock: { now: () => now } });
    const body = new Uint8Array(await envelopeFrom(alice, bob));
    const target = await signer.target({ method: "POST", target: "/envelopes", body });

    const arrived = new Promise(resolve => server.server.prependOnceListener("request", resolve));

    let release;
    const finish = new Promise(resolve => { release = resolve; });

    const response = fetch(`${base}${target}`, {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({
            async start(controller) {
                controller.enqueue(body.subarray(0, 1));
                await finish;
                controller.enqueue(body.subarray(1));
                controller.close();
            },
        }),
    });

    await arrived;
    await new Promise(resolve => setImmediate(resolve));
    now += 3_600_000;
    release();

    assert.equal((await response).status, 200);
});

test("a server given privateKeyHex uses that key", async () => {

    const identity = await PrivateIdentity.generate();
    const server = new SmerpServer({ privateKeyHex: await identity.exportPrivateHex() });

    assert.equal(await server.relayPkh(), identity.publicKeyHex);
});
