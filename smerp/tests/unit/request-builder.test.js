import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../../smep/src/index.js";
import { RequestBuilder } from "../../src/session/request-builder.js";
import { AuthHeaders, RequestVerifier } from "../../src/auth/request-signer.js";

const NOW = 1_750_201_234_567;
const clock = { now: () => NOW };
const RELAY_URL = "https://relay.test/base";

async function setup(options = {}) {

    const client = await PrivateIdentity.generate();
    const relay = await PrivateIdentity.generate();

    const builder = new RequestBuilder({ relayUrl: RELAY_URL, identity: client, clock, ...options });
    const verifier = new RequestVerifier({ identity: relay, clock });

    return { client, relay, builder, verifier };
}

function verify(verifier, request) {

    const target = request.url.slice(RELAY_URL.length);

    return verifier.verify({
        method: request.options.method,
        target,
        headers: request.options.headers,
        body: request.options.body,
    });
}

test("buildGet: GET /envelopes with the cursor, no body, 30 s timeout", async () => {

    const { builder } = await setup();

    const request = await builder.buildGet(12, null);

    assert.equal(request.url, `${RELAY_URL}/envelopes?cursor=12`);
    assert.equal(request.options.method, "GET");
    assert.equal("body" in request.options, false);
    assert.equal(request.timeout, 30 * 1000);
});

test("buildPost: POST /envelopes with the bytes as an octet-stream body", async () => {

    const { builder } = await setup();
    const body = new Uint8Array([1, 2, 3]);

    const request = await builder.buildPost(body, null);

    assert.equal(request.url, `${RELAY_URL}/envelopes`);
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.body, body);
    assert.equal(request.options.headers["content-type"], "application/octet-stream");
    assert.equal(request.timeout, 30 * 1000);
});

test("without a relay key the request is unsigned (first contact)", async () => {

    const { builder } = await setup();

    for (const request of [await builder.buildGet(0, null), await builder.buildPost(new Uint8Array(1), null)]) {
        for (const header of Object.values(AuthHeaders)) {
            assert.equal(header in request.options.headers, false, header);
        }
    }
});

test("a signed GET and POST verify at the relay and name the client", async () => {

    const { client, relay, builder, verifier } = await setup();

    const get = await builder.buildGet(7, relay.publicKeyHex);
    const post = await builder.buildPost(new Uint8Array([9, 9]), relay.publicKeyHex);

    for (const request of [get, post]) {
        assert.deepEqual(await verify(verifier, request), { ok: true, pkh: client.publicKeyHex });
    }
});

test("the timestamp is the clock's time in whole seconds", async () => {

    const { relay, builder } = await setup();

    const request = await builder.buildGet(0, relay.publicKeyHex);

    assert.equal(request.options.headers[AuthHeaders.timestamp], String(Math.floor(NOW / 1000)));
});

test("the signature covers cursor and body", async () => {

    const { relay, builder, verifier } = await setup();

    const get = await builder.buildGet(7, relay.publicKeyHex);
    const otherCursor = { ...get, url: get.url.replace("cursor=7", "cursor=8") };
    assert.equal((await verify(verifier, otherCursor)).ok, false);

    const post = await builder.buildPost(new Uint8Array([1, 2]), relay.publicKeyHex);
    const otherBody = { ...post, options: { ...post.options, body: new Uint8Array([1, 3]) } };
    assert.equal((await verify(verifier, otherBody)).ok, false);
});

test("a signature for one relay key does not verify at another", async () => {

    const { builder } = await setup();
    const other = await PrivateIdentity.generate();
    const otherVerifier = new RequestVerifier({ identity: other, clock });

    const somebody = (await PrivateIdentity.generate()).publicKeyHex;
    const request = await builder.buildGet(0, somebody);

    assert.equal((await verify(otherVerifier, request)).ok, false);
});

test("a token is sent in x-smerp-token, signed or not; none without a token", async () => {

    const { relay, builder: plain } = await setup();
    const { builder: gated } = await setup({ relayToken: "secret" });

    for (const relayPkh of [null, relay.publicKeyHex]) {

        const get = (await gated.buildGet(0, relayPkh)).options.headers;
        const post = (await gated.buildPost(new Uint8Array(1), relayPkh)).options.headers;

        assert.equal(get["x-smerp-token"], "secret");
        assert.equal(post["x-smerp-token"], "secret");
        assert.equal("authorization" in get, false);
        assert.equal("authorization" in post, false);

        assert.equal("x-smerp-token" in (await plain.buildGet(0, relayPkh)).options.headers, false);
    }
});

test("the HMAC key is derived once per relay key, again after a rotation", async () => {

    const { relay, builder, verifier } = await setup();

    await builder.buildGet(0, relay.publicKeyHex);
    const first = builder.cachedKey.keyPromise;

    await builder.buildGet(1, relay.publicKeyHex);
    assert.equal(builder.cachedKey.keyPromise, first);

    const rotated = await PrivateIdentity.generate();
    const request = await builder.buildGet(2, rotated.publicKeyHex);

    assert.notEqual(builder.cachedKey.keyPromise, first);
    assert.equal((await verify(new RequestVerifier({ identity: rotated, clock }), request)).ok, true);
    assert.equal((await verify(verifier, request)).ok, false);
});

test("the constructor insists on a relay URL and a private identity", async () => {

    const client = await PrivateIdentity.generate();

    assert.throws(() => new RequestBuilder({ relayUrl: 5, identity: client }));
    assert.throws(() => new RequestBuilder({ relayUrl: RELAY_URL, identity: {} }));
});
