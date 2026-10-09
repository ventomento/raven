import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity } from "../../smep/src/index.js";
import { symHmacKey, verify } from "../src/auth/protocol.js";
import { hmacSha256 } from "../../smep/src/crypto/hmac.js";
import { bytesToHex } from "../../smep/src/encoding/hex.js";

async function pair() {

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();

    return {
        alice,
        bob,
        alicePublic: new PublicIdentity(alice.publicKey),
        bobPublic: new PublicIdentity(bob.publicKey),
    };
}

test("verify accepts a signature made with the peer's derived key", async () => {

    const { alice, bobPublic, bob, alicePublic } = await pair();

    const aliceKey = await symHmacKey({ privateIdentity: alice, publicIdentity: bobPublic });

    const message = new TextEncoder().encode("1750201234");
    const signature = await hmacSha256(aliceKey, message);

    const ok = await verify({
        privateIdentity: bob,
        publicIdentity: alicePublic,
        dataHex: bytesToHex(message),
        signatureHex: bytesToHex(signature),
    });

    assert.equal(ok, true);
});

test("verify rejects a tampered message", async () => {

    const { alice, bobPublic, bob, alicePublic } = await pair();

    const aliceKey = await symHmacKey({ privateIdentity: alice, publicIdentity: bobPublic });

    const signature = await hmacSha256(aliceKey, new TextEncoder().encode("1750201234"));

    const ok = await verify({
        privateIdentity: bob,
        publicIdentity: alicePublic,
        dataHex: bytesToHex(new TextEncoder().encode("1750201235")),
        signatureHex: bytesToHex(signature),
    });

    assert.equal(ok, false);
});

test("verify rejects a signature from a different keypair", async () => {

    const { bob, alicePublic } = await pair();
    const mallory = await PrivateIdentity.generate();

    const malloryKey = await symHmacKey({
        privateIdentity: mallory,
        publicIdentity: new PublicIdentity(bob.publicKey),
    });

    const message = new TextEncoder().encode("1750201234");
    const signature = await hmacSha256(malloryKey, message);

    // Mallory claims to be Alice.
    const ok = await verify({
        privateIdentity: bob,
        publicIdentity: alicePublic,
        dataHex: bytesToHex(message),
        signatureHex: bytesToHex(signature),
    });

    assert.equal(ok, false);
});
