import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../../smep/src/index.js";
import { RequestSigner } from "../helpers/request-signer.js";
import { SmerpServer } from "../../src/server/index.js";
import { decodeBatch, MAX_ENVELOPE_BYTES } from "../../src/protocol/index.js";

async function startServer(t) {

    const server = new SmerpServer();
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    const base = `http://127.0.0.1:${server.server.address().port}`;

    const request = async (identity, { method = "GET", target, body, headers = {} }) => {

        const signer = new RequestSigner({ identity, relayPkh: await server.relayPkh() });

        return fetch(`${base}${target}`, {
            method,
            body,
            headers: { ...headers, ...(await signer.headers({ method, target, body })) },
        });
    };

    const post = (identity, body) => request(identity, {
        method: "POST",
        target: "/envelopes",
        body,
        headers: { "content-type": "application/octet-stream" },
    });

    const get = (identity, cursor = 0) => request(identity, { target: `/envelopes?cursor=${cursor}` });

    return { server, post, get };
}

const seal = (sender, recipient, plaintext) => encrypt({
    sender,
    recipient: new PublicIdentity(recipient.publicKey),
    plaintext,
});

const hashOf = (bytes) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

test("GET packs the signer's envelopes after the cursor into one batch", async (t) => {

    const { post, get } = await startServer(t);
    const [alice, bob, carol] = await Promise.all([1, 2, 3].map(() => PrivateIdentity.generate()));

    const toBob = [];
    for (const text of ["one", "two", "three"]) {
        const envelope = await seal(alice, bob, text);
        toBob.push(envelope);
        assert.equal((await post(alice, envelope)).status, 200);
        assert.equal((await post(alice, await seal(alice, carol, text))).status, 200);
    }

    const res = await get(bob);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-smerp-cursor"), "5");

    const { frames, error } = decodeBatch(await res.arrayBuffer());
    assert.equal(error, null);
    assert.deepEqual(frames.map(hashOf), toBob.map(hashOf));

    const rest = decodeBatch(await (await get(bob, 1)).arrayBuffer());
    assert.deepEqual(rest.frames.map(hashOf), toBob.slice(1).map(hashOf));

    assert.equal((await get(bob, 5)).status, 204);
});

test("a batch holds at most 4 MiB of envelopes, but always one", async (t) => {

    const { post, get } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const big = await seal(alice, bob, new Uint8Array(3 * 1024 * 1024));
    const medium = await seal(alice, bob, new Uint8Array(1.5 * 1024 * 1024));
    const small = await seal(alice, bob, "small");

    for (const envelope of [big, medium, small]) {
        assert.equal((await post(alice, envelope)).status, 200);
    }

    const first = await get(bob);
    assert.equal(first.headers.get("x-smerp-cursor"), "1");
    assert.deepEqual(decodeBatch(await first.arrayBuffer()).frames.map(hashOf), [hashOf(big)]);

    const second = await get(bob, 1);
    assert.equal(second.headers.get("x-smerp-cursor"), "3");
    assert.deepEqual(
        decodeBatch(await second.arrayBuffer()).frames.map(hashOf),
        [hashOf(medium), hashOf(small)]
    );
});

test("a POST of bytes already held is 200 and stored once", async (t) => {

    const { post, get } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const envelope = await seal(alice, bob, "once");

    assert.equal((await post(alice, envelope)).status, 200);
    assert.equal((await post(bob, envelope)).status, 200);

    const { frames } = decodeBatch(await (await get(bob)).arrayBuffer());
    assert.deepEqual(frames.map(hashOf), [hashOf(envelope)]);
});

test("an envelope posted first with a copied header does not displace the real one", async (t) => {

    const { post, get } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const real = await seal(alice, bob, "the real one");
    const squat = new Uint8Array(real.slice(0));
    squat[squat.length - 1] ^= 0xff;

    assert.equal((await post(alice, squat)).status, 200);
    assert.equal((await post(alice, real)).status, 200);

    const { frames } = decodeBatch(await (await get(bob)).arrayBuffer());
    assert.deepEqual(frames.map(hashOf), [hashOf(squat), hashOf(real)]);
});

test("POST of a body over 4 MiB is refused with 400", async (t) => {

    const { post } = await startServer(t);
    const alice = await PrivateIdentity.generate();

    const res = await post(alice, new Uint8Array(MAX_ENVELOPE_BYTES + 1));

    assert.equal(res.status, 400);
});

test("a chunked POST over 4 MiB is refused with 400 before it is read in full", async (t) => {

    const { server } = await startServer(t);

    // A stream body is sent chunked, so the relay cannot reject on Content-Length.
    // It is unsigned: a relay that read it all would get to auth and answer 401.
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({
        start(controller) {
            for (let i = 0; i <= MAX_ENVELOPE_BYTES / chunk.byteLength; i++) {
                controller.enqueue(chunk);
            }
            controller.close();
        },
    });

    const res = await fetch(`http://127.0.0.1:${server.server.address().port}/envelopes`, {
        method: "POST",
        body: stream,
        duplex: "half",
        headers: { "content-type": "application/octet-stream" },
    });

    assert.equal(res.status, 400);
});

test("GET with a malformed cursor is refused with 400", async (t) => {

    const { get } = await startServer(t);
    const alice = await PrivateIdentity.generate();

    for (const cursor of ["-1", "abc", "1e3", "0x10", ""]) {
        assert.equal((await get(alice, cursor)).status, 400, `cursor "${cursor}"`);
    }
});

test("GET /dump lists the stored envelopes", async (t) => {

    const { server, post } = await startServer(t);
    const [alice, bob] = await Promise.all([1, 2].map(() => PrivateIdentity.generate()));

    const envelope = await seal(alice, bob, "dumped");
    await post(alice, envelope);

    const res = await fetch(`http://127.0.0.1:${server.server.address().port}/dump`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{
        id: 1,
        hash: hashOf(envelope),
        spkh: alice.publicKeyHex,
        rpkh: bob.publicKeyHex,
        size: envelope.byteLength,
    }]);
});

test("every response carries the storage's epoch, readable by browsers; new storage gets a new one", async (t) => {

    const { server, get } = await startServer(t);
    const alice = await PrivateIdentity.generate();

    assert.match(server.storage.epoch, /^[0-9a-f]{32}$/);

    const res = await get(alice);
    assert.equal(res.headers.get("x-smerp-epoch"), server.storage.epoch);
    assert.match(res.headers.get("access-control-expose-headers"), /\bx-smerp-epoch\b/);

    const other = new SmerpServer();
    assert.notEqual(other.storage.epoch, server.storage.epoch);

    const kept = new SmerpServer({ storage: server.storage });
    assert.equal(kept.storage.epoch, server.storage.epoch, "the epoch belongs to the storage");
});
