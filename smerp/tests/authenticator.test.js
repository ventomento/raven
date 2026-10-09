import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../smep/src/index.js";
import { Authenticator } from "../src/auth/authenticator.js";

test("authentication headers are stable for same timestamp", async () => {

    const identity = await PrivateIdentity.generate();

    const relay = {
        relayPkh: await identity.exportPublicHex()
    };

    const auth = new Authenticator({
        identity,
        relay,
        clock: { now: () => 1750201234567 }
    });

    const headers1 = await auth.headers();
    const headers2 = await auth.headers();

    assert.equal(
        headers1["x-smerp-timestamp"],
        "1750201234"
    );

    assert.equal(
        headers2["x-smerp-timestamp"],
        "1750201234"
    );

    assert.deepStrictEqual(
        headers1["x-smerp-signature"],
        headers2["x-smerp-signature"]
    );

});

test("symmetric key is cached", async () => {

    const identity = await PrivateIdentity.generate();

    const relay = {
        relayPkh: await identity.exportPublicHex()
    };

    const auth = new Authenticator({
        identity,
        relay
    });

    const key1 = await auth.symKey();
    const key2 = await auth.symKey();

    assert.strictEqual(
        key1,
        key2
    );

});

test("headers contain required authentication fields", async () => {

    const identity = await PrivateIdentity.generate();

    const relay = {
        relayPkh: await identity.exportPublicHex()
    };

    const auth = new Authenticator({
        identity,
        relay
    });

    const headers = await auth.headers();

    assert.ok(
        "x-smerp-timestamp" in headers
    );

    assert.ok(
        "x-smerp-signature" in headers
    );

    assert.equal(
        typeof headers["x-smerp-timestamp"],
        "string"
    );

    // Lowercase hex of the 32-byte HMAC-SHA256 output (auth_rfc.txt).
    assert.match(
        headers["x-smerp-signature"],
        /^[0-9a-f]{64}$/
    );

});

test("headers throw when the relay has no relayPkh", async () => {

    const identity = await PrivateIdentity.generate();

    const auth = new Authenticator({
        identity,
        relay: {}
    });

    await assert.rejects(
        auth.headers(),
        /no relayPkh/
    );

});