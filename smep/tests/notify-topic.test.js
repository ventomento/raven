import test from "node:test";
import assert from "node:assert/strict";

import { notifyTopic } from "../src/protocol/notify-topic.js";
import { PrivateIdentity } from "../src/identity/identity.js";

// The test vector in smerp_rfc section 7, cross-checked with an
// independent RFC 7748 implementation.
const VECTOR = {
  alicePrivate: "40".repeat(31) + "41",
  bobPrivate: "50".repeat(31) + "51",
  alicePublic: "16cc47ba4376ea9de41e2e0d41d924292b54c74b2a9b76201b3aa51a6906654e",
  bobPublic: "f55fc0309085dc04138f57894ebd864fae33581c7c7a0bf4bd5bd2790a172165",
  aliceToBob: "raven-7393d61a4b43bc37bd434fd736f061f4",
  bobToAlice: "raven-21c3bb9c242c2d5ee31685d3a910898c",
};

test("matches the spec's test vector, derived by either party", async () => {

  const alice = await PrivateIdentity.fromPrivateKeyHex(VECTOR.alicePrivate);
  const bob = await PrivateIdentity.fromPrivateKeyHex(VECTOR.bobPrivate);

  assert.equal(alice.publicKeyHex, VECTOR.alicePublic);
  assert.equal(bob.publicKeyHex, VECTOR.bobPublic);

  assert.equal(await notifyTopic(alice, VECTOR.alicePublic, VECTOR.bobPublic), VECTOR.aliceToBob);
  assert.equal(await notifyTopic(bob, VECTOR.alicePublic, VECTOR.bobPublic), VECTOR.aliceToBob);
  assert.equal(await notifyTopic(alice, VECTOR.bobPublic, VECTOR.alicePublic), VECTOR.bobToAlice);
  assert.equal(await notifyTopic(bob, VECTOR.bobPublic, VECTOR.alicePublic), VECTOR.bobToAlice);
});

test("both parties agree, each direction differs, and the format fits ntfy", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const aliceToBob = await notifyTopic(alice, alice.publicKeyHex, bob.publicKeyHex);
  const bobToAlice = await notifyTopic(alice, bob.publicKeyHex, alice.publicKeyHex);

  assert.equal(await notifyTopic(bob, alice.publicKeyHex, bob.publicKeyHex), aliceToBob);
  assert.notEqual(aliceToBob, bobToAlice);
  assert.match(aliceToBob, /^raven-[0-9a-f]{32}$/);
});

test("ignores the case of the keys", async () => {

  const alice = await PrivateIdentity.fromPrivateKeyHex(VECTOR.alicePrivate);

  assert.equal(
    await notifyTopic(alice, VECTOR.alicePublic.toUpperCase(), VECTOR.bobPublic.toUpperCase()),
    VECTOR.aliceToBob
  );
});

test("refuses an identity that is not a party, and a note to self", async () => {

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const carol = await PrivateIdentity.generate();

  await assert.rejects(notifyTopic(carol, alice.publicKeyHex, bob.publicKeyHex), /sender or the recipient/);
  await assert.rejects(notifyTopic(alice, alice.publicKeyHex, alice.publicKeyHex), /note to self/);
  await assert.rejects(notifyTopic({}, alice.publicKeyHex, bob.publicKeyHex));
});
