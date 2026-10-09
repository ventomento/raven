import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity } from "../../smep/src/index.js";
import { symHmacKey, signedHeaders } from "../src/auth/protocol.js";
import { SmerpServer } from "../src/server/index.js";

async function startServer(t) {

    const server = new SmerpServer();
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return `http://127.0.0.1:${server.server.address().port}`;
}

async function headersFor(identity) {

    const relay = await PublicIdentity.fromPublicHex(SmerpServer.PUBLIC_KEY_HEX);
    const key = await symHmacKey({ privateIdentity: identity, publicIdentity: relay });

    return signedHeaders(key);
}

test("GET /envelopes with valid auth succeeds", async (t) => {

    const base = await startServer(t);
    const identity = await PrivateIdentity.generate();

    const res = await fetch(`${base}/envelopes?pkh=${identity.publicKeyHex}&cursor=0`, {
        headers: await headersFor(identity),
    });

    assert.equal(res.status, 204);
});

test("GET /envelopes rejects a malformed or low-order pkh with 401", async (t) => {

    const base = await startServer(t);
    const identity = await PrivateIdentity.generate();
    const headers = await headersFor(identity);

    for (const pkh of ["zz", "abcd", "00".repeat(32)]) {

        const res = await fetch(`${base}/envelopes?pkh=${pkh}&cursor=0`, { headers });

        assert.equal(res.status, 401, `pkh=${pkh}`);
        assert.equal(res.headers.get("x-smerp-unauthorized"), "invalid signature");
    }
});

test("GET /envelopes rejects a non-hex signature with 401", async (t) => {

    const base = await startServer(t);
    const identity = await PrivateIdentity.generate();
    const headers = { ...(await headersFor(identity)), "x-smerp-signature": "not hex" };

    const res = await fetch(`${base}/envelopes?pkh=${identity.publicKeyHex}&cursor=0`, { headers });

    assert.equal(res.status, 401);
});

test("GET /envelopes without pkh is rejected with 401", async (t) => {

    const base = await startServer(t);
    const identity = await PrivateIdentity.generate();

    const res = await fetch(`${base}/envelopes?cursor=0`, {
        headers: await headersFor(identity),
    });

    assert.equal(res.status, 401);
});
