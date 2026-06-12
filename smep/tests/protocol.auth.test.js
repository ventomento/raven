// tests/protocol.auth.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  authSign,
  authSessionKey,
} from "../src/protocol/protocol.js";

import {
  PrivateIdentity,
} from "../src/identity/identity.js";

import { encodeUtf8 } from "../src/encoding/utf8.js";
import { hmacSha256 } from "../src/crypto/hmac.js";

// ============================================================
// authSign
// ============================================================

test("authSign returns timestamp and valid HMAC signature", async () => {
  const symKey = crypto.getRandomValues(new Uint8Array(32));

  const { timestamp, signature } = await authSign(symKey);

  assert.equal(typeof timestamp, "string");

  const expectedSignature = await hmacSha256(
    symKey,
    encodeUtf8(timestamp)
  );

  assert.deepEqual(signature, expectedSignature);
});

test("authSign produces different signatures over time", async () => {
  const symKey = crypto.getRandomValues(new Uint8Array(32));

  const first = await authSign(symKey);

  await new Promise((r) => setTimeout(r, 1100));

  const second = await authSign(symKey);

  assert.notEqual(first.timestamp, second.timestamp);
  assert.notDeepEqual(first.signature, second.signature);
});

// ============================================================
// authSessionKey
// ============================================================

test("authSessionKey derives identical keys on both sides", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const aliceKey = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: await bob.exportPublicHex(),
  });

  const bobKey = await authSessionKey({
    identity: bob,
    ephemeralPublicKeyHex: await alice.exportPublicHex(),
  });

  assert.deepEqual(aliceKey, bobKey);
});

test("authSessionKey returns 32-byte SHA-256 key", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const key = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: await bob.exportPublicHex(),
  });

  assert.ok(key instanceof Uint8Array);
  assert.equal(key.length, 32);
});

test("authSessionKey differs for different peers", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();
  const charlie = await PrivateIdentity.generate();

  const key1 = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: await bob.exportPublicHex(),
  });

  const key2 = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: await charlie.exportPublicHex(),
  });

  assert.notDeepEqual(key1, key2);
});

test("authSessionKey is deterministic", async () => {
  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const pub = await bob.exportPublicHex();

  const key1 = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: pub,
  });

  const key2 = await authSessionKey({
    identity: alice,
    ephemeralPublicKeyHex: pub,
  });

  assert.deepEqual(key1, key2);
});

test("authSessionKey rejects invalid input type", async () => {
  const alice = await PrivateIdentity.generate();

  await assert.rejects(
    () =>
      authSessionKey({
        identity: alice,
        ephemeralPublicKeyHex: 123,
      }),
    /string/i
  );
});