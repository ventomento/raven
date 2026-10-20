import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../../smep/src/index.js";
import { RequestSigner } from "../helpers/request-signer.js";
import { SmerpServer } from "../../src/server/index.js";

async function startServer(t, options) {

    const server = new SmerpServer(options);
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return {
        server,
        base: `http://127.0.0.1:${server.server.address().port}`,
    };
}

async function signedFetch(server, base, identity, { method = "GET", target, body, headers = {} }) {

    const signer = new RequestSigner({ identity, relayPkh: await server.relayPkh() });

    return fetch(`${base}${target}`, {
        method,
        body,
        headers: { ...headers, ...(await signer.headers({ method, target, body })) },
    });
}

function post(server, base, identity, envelope, headers = {}) {

    return signedFetch(server, base, identity, {
        method: "POST",
        target: "/envelopes",
        body: envelope,
        headers: { "content-type": "application/octet-stream", ...headers },
    });
}

function get(server, base, identity, cursor = 0, headers = {}) {
    return signedFetch(server, base, identity, { target: `/envelopes?cursor=${cursor}`, headers });
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
            headers: { "content-type": "application/octet-stream" },
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
    const headers = await signer.headers({ method: "GET", target: "/envelopes?cursor=0" });

    const res = await fetch(`${base}/envelopes?cursor=5`, { headers });

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

test("a relay with tokens requires a valid x-smerp-token on GET and POST", async (t) => {

    const { server, base } = await startServer(t, { tokens: new Set(["secret"]) });
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));
    const envelope = await envelopeFrom(alice, bob);

    const refused = [
        {},
        { "x-smerp-token": "wrong" },
        { "x-smerp-token": "Bearer secret" },
        { authorization: "Bearer secret" },
    ];

    for (const headers of refused) {
        assert.equal((await get(server, base, alice, 0, headers)).status, 401);
        assert.equal((await post(server, base, alice, envelope, headers)).status, 401);
    }

    const ok = { "x-smerp-token": "secret" };
    assert.equal((await post(server, base, alice, envelope, ok)).status, 200);
    assert.equal((await get(server, base, alice, 0, ok)).status, 200);
});

test("every response carries the relay pkh and no-store, and rotateKey changes the pkh", async (t) => {

    const { server, base } = await startServer(t);
    const relayPkh = await server.relayPkh();

    assert.match(relayPkh, /^[0-9a-f]{64}$/);

    for (const path of ["/", "/nope", "/envelopes?cursor=0"]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.headers.get("x-smerp-relay-pkh"), relayPkh, path);
        assert.equal(res.headers.get("cache-control"), "no-store", path);
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
    const target = "/envelopes?cursor=0";
    const headers = await signer.headers({ method: "GET", target });

    await server.rotateKey();

    const res = await fetch(`${base}${target}`, { headers });

    assert.equal(res.status, 401);
});

test("a server given privateKeyHex uses that key", async () => {

    const identity = await PrivateIdentity.generate();
    const server = new SmerpServer({ privateKeyHex: await identity.exportPrivateHex() });

    assert.equal(await server.relayPkh(), identity.publicKeyHex);
});
