// test/hmac-protocol.test.js

import assert from "node:assert/strict";

import {
  PrivateIdentity,
  PublicIdentity
} from "../../smep/src/index.js";

import {
  symHmacKey
} from "../src/auth/protocol.js";

import {
  hmacSha256
} from "../../smep/src/crypto/hmac.js";

import {
  bytesToHex
} from "../../smep/src/encoding/hex.js";

import {
  verify
} from "../src/auth/protocol.js";

async function testHmacProtocol() {

  console.log("Generating identities...");

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const bobPublic =
    new PublicIdentity(bob.publicKey);

  const alicePublic =
    new PublicIdentity(alice.publicKey);

  console.log("Deriving keys...");

  const aliceKey = await symHmacKey(
    alice,
    bobPublic
  );

  const bobKey = await symHmacKey(
    bob,
    alicePublic
  );

  const message =
    new TextEncoder().encode(
      "hello world"
    );

  const signature =
    await hmacSha256(
      aliceKey,
      message
    );

  const ok = await verify({
    privateIdentity: bob,
    publicIdentity: alicePublic,
    dataHex: bytesToHex(message),
    signatureHex: bytesToHex(signature)
  });

  assert.equal(ok, true);

  console.log(
    "✓ valid signature verified"
  );

  const tampered =
    new TextEncoder().encode(
      "hello hacker"
    );

  const bad = await verify({
    privateIdentity: bob,
    publicIdentity: alicePublic,
    dataHex: bytesToHex(tampered),
    signatureHex: bytesToHex(signature)
  });

  assert.equal(bad, false);

  console.log(
    "✓ tampered message rejected"
  );

  console.log(
    "\nAll tests passed."
  );
}

testHmacProtocol().catch(err => {
  console.error(err);
  process.exit(1);
});