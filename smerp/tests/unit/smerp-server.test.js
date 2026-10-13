import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt, readEnvelope, bytesToHex } from "../../../smep/src/index.js";
import { RequestSigner } from "../../src/auth/request-signer.js";
import { SmerpServer } from "../../src/server/index.js";
import { decodeBatch, MAX_ENVELOPE_BYTES } from "../../src/protocol/index.js";

// Wire behavior of the mock relay: batched GET and the envelope size limit.

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

const uuidOf = (bytes) => bytesToHex(readEnvelope(bytes).uuid);

test("GET packs the signer's envelopes after the cursor into one batch", async (t) => {

    const { post, get } = await startServer(t);
    const [alice, bob, carol] = await Promise.all([1, 2, 3].map(() => PrivateIdentity.generate()));

    const toBob = [];
    for (const text of ["one", "two", "three"]) {
        const envelope = await seal(alice, bob, text);
        toBob.push(envelope);
        assert.equal((await post(alice, envelope)).status, 200);
        // someone else's mail in between
        assert.equal((await post(alice, await seal(alice, carol, text))).status, 200);
    }

    const res = await get(bob);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-smerp-cursor"), "5");

    const { frames, error } = decodeBatch(await res.arrayBuffer());
    assert.equal(error, null);
    assert.deepEqual(frames.map(uuidOf), toBob.map(uuidOf));

    // after the first envelope's id (1), the rest
    const rest = decodeBatch(await (await get(bob, 1)).arrayBuffer());
    assert.deepEqual(rest.frames.map(uuidOf), toBob.slice(1).map(uuidOf));

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

    // 3 MiB + 1.5 MiB would not fit, so the big one goes alone
    const first = await get(bob);
    assert.equal(first.headers.get("x-smerp-cursor"), "1");
    assert.deepEqual(decodeBatch(await first.arrayBuffer()).frames.map(uuidOf), [uuidOf(big)]);

    const second = await get(bob, 1);
    assert.equal(second.headers.get("x-smerp-cursor"), "3");
    assert.deepEqual(
        decodeBatch(await second.arrayBuffer()).frames.map(uuidOf),
        [uuidOf(medium), uuidOf(small)]
    );
});

test("POST of a body over 4 MiB is refused with 400", async (t) => {

    const { post } = await startServer(t);
    const alice = await PrivateIdentity.generate();

    const res = await post(alice, new Uint8Array(MAX_ENVELOPE_BYTES + 1));

    assert.equal(res.status, 400);
});
