import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../smep/src/index.js";
import {
    AuthHeaders,
    RequestSigner,
    RequestVerifier,
    bodyHashHex,
    canonicalRequest,
    normalizePkh,
} from "../src/auth/request-signer.js";

const NOW = 1_750_201_234_000;
const clockAt = (ms) => ({ now: () => ms });

async function setup({ signerClock = clockAt(NOW), verifierClock = clockAt(NOW) } = {}) {

    const client = await PrivateIdentity.generate();
    const relay = await PrivateIdentity.generate();

    const signer = new RequestSigner({ identity: client, relayPkh: relay.publicKeyHex, clock: signerClock });
    const verifier = new RequestVerifier({ identity: relay, clock: verifierClock });

    return { client, relay, signer, verifier };
}

const GET = { method: "GET", target: "/envelopes?cursor=12" };
const POST = { method: "POST", target: "/envelopes", body: new Uint8Array([1, 2, 3]) };

test("canonicalRequest joins method, target, timestamp and body hash", () => {

    assert.equal(
        canonicalRequest({ method: "GET", target: "/envelopes?cursor=1", timestamp: "5", bodyHashHex: "ab" }),
        "GET\n/envelopes?cursor=1\n5\nab"
    );
});

test("bodyHashHex hashes no body as zero bytes, whatever the empty form", async () => {

    const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    assert.equal(await bodyHashHex(undefined), empty);
    assert.equal(await bodyHashHex(null), empty);
    assert.equal(await bodyHashHex(new Uint8Array(0)), empty);
    assert.equal(await bodyHashHex(new ArrayBuffer(0)), empty);
    assert.equal(
        await bodyHashHex(new Uint8Array([1, 2]).buffer),
        await bodyHashHex(new Uint8Array([1, 2]))
    );
});

test("normalizePkh accepts 0x and uppercase, rejects anything else", () => {

    assert.equal(normalizePkh(`0x${"AB".repeat(32)}`), "ab".repeat(32));
    assert.equal(normalizePkh("ab".repeat(31)), null);
    assert.equal(normalizePkh("zz".repeat(32)), null);
    assert.equal(normalizePkh(undefined), null);
});

test("a signed GET and POST verify and name the signer", async () => {

    const { client, signer, verifier } = await setup();

    for (const request of [GET, POST]) {

        const headers = await signer.headers(request);

        assert.equal(headers[AuthHeaders.pkh], client.publicKeyHex);
        assert.equal(headers[AuthHeaders.timestamp], String(NOW / 1000));
        assert.deepEqual(await verifier.verify({ ...request, headers }), { ok: true, pkh: client.publicKeyHex });
    }
});

test("changing method, target, body or timestamp breaks the signature", async () => {

    const { signer, verifier } = await setup();

    const getHeaders = await signer.headers(GET);
    const postHeaders = await signer.headers(POST);

    const tampered = [
        { ...GET, method: "POST", headers: getHeaders },
        { ...GET, target: "/envelopes?cursor=13", headers: getHeaders },
        { ...GET, body: new Uint8Array([0]), headers: getHeaders },
        { ...POST, body: new Uint8Array([1, 2, 4]), headers: postHeaders },
        { ...GET, headers: { ...getHeaders, [AuthHeaders.timestamp]: String(NOW / 1000 + 1) } },
    ];

    for (const request of tampered) {
        assert.deepEqual(await verifier.verify(request), { ok: false, reason: "invalid signature" });
    }
});

test("a signature claiming another signer pkh fails", async () => {

    const { signer, verifier } = await setup();
    const other = await PrivateIdentity.generate();

    const headers = { ...(await signer.headers(GET)), [AuthHeaders.pkh]: other.publicKeyHex };

    assert.equal((await verifier.verify({ ...GET, headers })).ok, false);
});

test("a signature for another relay key fails", async () => {

    const { client, verifier } = await setup();
    const elsewhere = await PrivateIdentity.generate();

    const signer = new RequestSigner({ identity: client, relayPkh: elsewhere.publicKeyHex, clock: clockAt(NOW) });

    assert.equal((await verifier.verify({ ...GET, headers: await signer.headers(GET) })).ok, false);
});

test("timestamps outside the 300 second window fail", async () => {

    for (const skew of [-301_000, 301_000]) {

        const { signer, verifier } = await setup({ signerClock: clockAt(NOW + skew) });

        assert.deepEqual(
            await verifier.verify({ ...GET, headers: await signer.headers(GET) }),
            { ok: false, reason: "timestamp out of window" }
        );
    }

    const { signer, verifier } = await setup({ signerClock: clockAt(NOW + 300_000) });
    assert.equal((await verifier.verify({ ...GET, headers: await signer.headers(GET) })).ok, true);
});

test("missing or malformed auth headers fail without throwing", async () => {

    const { signer, verifier } = await setup();
    const headers = await signer.headers(GET);

    const cases = [
        [{}, "missing signature"],
        [{ ...headers, [AuthHeaders.pkh]: "zz" }, "missing signature"],
        [{ ...headers, [AuthHeaders.pkh]: "00".repeat(32) }, "invalid signature"],
        [{ ...headers, [AuthHeaders.signature]: "not hex" }, "invalid signature"],
        [{ ...headers, [AuthHeaders.timestamp]: "soon" }, "timestamp out of window"],
    ];

    for (const [badHeaders, reason] of cases) {
        assert.deepEqual(await verifier.verify({ ...GET, headers: badHeaders }), { ok: false, reason });
    }
});
