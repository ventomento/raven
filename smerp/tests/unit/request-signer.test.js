import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../../smep/src/internal.js";
import {
    RequestVerifier,
    bodyHashHex,
    canonicalRequest,
    normalizePkh,
} from "../../src/auth/request-signer.js";
import { RequestSigner } from "../helpers/request-signer.js";

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

test("canonicalRequest joins method, signed target and body hash", () => {

    assert.equal(
        canonicalRequest({ method: "GET", signedTarget: "/envelopes?cursor=1&pkh=a&ts=5", bodyHashHex: "ab" }),
        "GET\n/envelopes?cursor=1&pkh=a&ts=5\nab"
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

        const target = await signer.target(request);

        assert.ok(target.startsWith(`${request.target}${request.target.includes("?") ? "&" : "?"}pkh=${client.publicKeyHex}&ts=${NOW / 1000}&sig=`));
        assert.match(target, /&sig=[0-9a-f]{64}$/);
        assert.deepEqual(await verifier.verify({ ...request, target }), { ok: true, pkh: client.publicKeyHex });
    }
});

test("changing method, target, body or timestamp breaks the signature", async () => {

    const { signer, verifier } = await setup();

    const get = await signer.target(GET);
    const post = await signer.target(POST);

    const tampered = [
        { method: "POST", target: get },
        { method: "GET", target: get.replace("cursor=12", "cursor=13") },
        { method: "GET", target: get, body: new Uint8Array([0]) },
        { method: "POST", target: post, body: new Uint8Array([1, 2, 4]) },
        { method: "GET", target: get.replace(`ts=${NOW / 1000}`, `ts=${NOW / 1000 + 1}`) },
    ];

    for (const request of tampered) {
        assert.deepEqual(await verifier.verify(request), { ok: false, reason: "invalid signature" });
    }
});

test("a signature claiming another signer pkh fails", async () => {

    const { client, signer, verifier } = await setup();
    const other = await PrivateIdentity.generate();

    const target = (await signer.target(GET)).replace(client.publicKeyHex, other.publicKeyHex);

    assert.equal((await verifier.verify({ ...GET, target })).ok, false);
});

test("a signature for another relay key fails", async () => {

    const { client, verifier } = await setup();
    const elsewhere = await PrivateIdentity.generate();

    const signer = new RequestSigner({ identity: client, relayPkh: elsewhere.publicKeyHex, clock: clockAt(NOW) });

    assert.equal((await verifier.verify({ ...GET, target: await signer.target(GET) })).ok, false);
});

test("timestamps outside the 60 second window fail", async () => {

    for (const skew of [-61_000, 61_000]) {

        const { signer, verifier } = await setup({ signerClock: clockAt(NOW + skew) });

        assert.deepEqual(
            await verifier.verify({ ...GET, target: await signer.target(GET) }),
            { ok: false, reason: "timestamp out of window" }
        );
    }

    for (const skew of [-60_000, 60_000]) {

        const { signer, verifier } = await setup({ signerClock: clockAt(NOW + skew) });

        assert.equal((await verifier.verify({ ...GET, target: await signer.target(GET) })).ok, true);
    }
});

test("the timestamp is checked against when the request arrived, if given", async () => {

    const { signer, verifier } = await setup({ verifierClock: clockAt(NOW + 3_600_000) });

    const target = await signer.target(POST);

    assert.equal((await verifier.verify({ ...POST, target })).reason, "timestamp out of window");
    assert.equal((await verifier.verify({ ...POST, target, arrivedAt: NOW })).ok, true);
});

test("missing or malformed auth parameters fail without throwing", async () => {

    const { client, signer, verifier } = await setup();
    const target = await signer.target(GET);
    const signature = target.slice(target.indexOf("&sig=") + 5);

    const cases = [
        ["/envelopes?cursor=12", "missing signature"],
        ["/envelopes", "missing signature"],
        ["/envelopes&sig=ab", "missing signature"],
        [target.slice(0, target.indexOf("&sig=")), "missing signature"],
        [target.replace(`pkh=${client.publicKeyHex}&`, ""), "missing signature"],
        [target.replace(`ts=${NOW / 1000}&`, ""), "missing signature"],
        [target.replace(client.publicKeyHex, "zz"), "missing signature"],
        [target.replace(client.publicKeyHex, "00".repeat(32)), "invalid signature"],
        [target.replace(signature, "nothex"), "invalid signature"],
        [`${target}&after=1`, "invalid signature"],
        [target.replace(`ts=${NOW / 1000}`, "ts=soon"), "timestamp out of window"],
    ];

    for (const [badTarget, reason] of cases) {
        assert.deepEqual(await verifier.verify({ ...GET, target: badTarget }), { ok: false, reason }, badTarget);
    }
});
