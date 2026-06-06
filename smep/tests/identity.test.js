// test/identity.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  PrivateIdentity,
  PublicIdentity
} from "../src/identity/identity.js";

test("PrivateIdentity.generate() creates valid identity", async () => {
  const identity = await PrivateIdentity.generate();

  assert.ok(identity instanceof PrivateIdentity);

  assert.ok(identity.privateKey instanceof CryptoKey);
  assert.ok(identity.publicKey instanceof CryptoKey);

  assert.equal(identity.privateKey.type, "private");
  assert.equal(identity.publicKey.type, "public");

  assert.equal(
    typeof identity.publicKeyHex,
    "string"
  );

  assert.ok(identity.publicKeyHex.length > 0);
});

test("exportPublicHex() returns string", async () => {
  const identity = await PrivateIdentity.generate();

  const hex =
    await identity.exportPublicHex();

  assert.equal(typeof hex, "string");
  assert.ok(hex.length > 0);
});

test("exportPrivateHex() returns string", async () => {
  const identity = await PrivateIdentity.generate();

  const hex =
    await identity.exportPrivateHex();

  assert.equal(typeof hex, "string");
  assert.ok(hex.length > 0);
});

test("identity can be restored from private key hex", async () => {
  const original =
    await PrivateIdentity.generate();

  const privateHex =
    await original.exportPrivateHex();

  const restored =
    await PrivateIdentity.fromPrivateKeyHex(
      privateHex
    );

  const originalPublic =
    await original.exportPublicHex();

  const restoredPublic =
    await restored.exportPublicHex();

  assert.equal(
    restoredPublic,
    originalPublic
  );
});

test("PublicIdentity can be restored from public hex", async () => {
  const identity =
    await PrivateIdentity.generate();

  const publicHex =
    await identity.exportPublicHex();

  const publicIdentity =
    await PublicIdentity.fromPublicHex(
      publicHex
    );

  assert.ok(
    publicIdentity instanceof PublicIdentity
  );

  assert.equal(
    publicIdentity.publicKey.type,
    "public"
  );
});

test("PrivateIdentity constructor rejects non-CryptoKey private key", () => {
  assert.throws(
    () =>
      new PrivateIdentity({
        privateKey: {},
        publicKey: {}
      }),
    /privateKey must be CryptoKey/
  );
});

test("PublicIdentity constructor rejects non-CryptoKey", () => {
  assert.throws(
    () => new PublicIdentity({}),
    /publicKey must be cryptokey/
  );
});

test("PrivateIdentity instances are frozen", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.ok(
    Object.isFrozen(identity)
  );
});

test("PublicIdentity instances are frozen", async () => {
  const identity =
    await PrivateIdentity.generate();

  const publicIdentity =
    new PublicIdentity(identity.publicKey);

  assert.ok(
    Object.isFrozen(publicIdentity)
  );
});

test("publicKeyHex matches exportPublicHex()", async () => {
  const identity =
    await PrivateIdentity.generate();

  const exported =
    await identity.exportPublicHex();

  assert.equal(
    identity.publicKeyHex,
    exported
  );
});

test("fromPrivateKeyHex preserves private key", async () => {
  const original =
    await PrivateIdentity.generate();

  const privateHex =
    await original.exportPrivateHex();

  const restored =
    await PrivateIdentity.fromPrivateKeyHex(
      privateHex
    );

  const restoredPrivateHex =
    await restored.exportPrivateHex();

  assert.equal(
    restoredPrivateHex,
    privateHex
  );
});

test("fromPrivateKeyHex deterministically derives same public key", async () => {
  const identity =
    await PrivateIdentity.generate();

  const privateHex =
    await identity.exportPrivateHex();

  const restored1 =
    await PrivateIdentity.fromPrivateKeyHex(
      privateHex
    );

  const restored2 =
    await PrivateIdentity.fromPrivateKeyHex(
      privateHex
    );

  assert.equal(
    await restored1.exportPublicHex(),
    await restored2.exportPublicHex()
  );
});

test("exportPublicBytes returns 32-byte Uint8Array", async () => {
  const identity =
    await PrivateIdentity.generate();

  const bytes =
    await identity.exportPublicBytes();

  assert.ok(
    bytes instanceof Uint8Array
  );

  assert.equal(
    bytes.length,
    32
  );
});

test("PrivateIdentity constructor rejects non-CryptoKey public key", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.throws(() => {

    new PrivateIdentity({
      privateKey: identity.privateKey,
      publicKey: {}
    });

  }, /publicKey must be CryptoKey/);
});

test("PrivateIdentity constructor rejects non-CryptoKey private key", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.throws(() => {

    new PrivateIdentity({
      privateKey: {},
      publicKey: identity.publicKey
    });

  }, /privateKey must be CryptoKey/);
});

test("PrivateIdentity constructor rejects public CryptoKey as privateKey", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.throws(() => {

    new PrivateIdentity({
      privateKey: identity.publicKey,
      publicKey: identity.publicKey
    });

  }, /private/);
});

test("PrivateIdentity constructor rejects private CryptoKey as publicKey", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.throws(() => {

    new PrivateIdentity({
      privateKey: identity.privateKey,
      publicKey: identity.privateKey
    });

  }, /public/);
});

test("generate populates publicKeyHex", async () => {
  const identity =
    await PrivateIdentity.generate();

  assert.equal(
    typeof identity.publicKeyHex,
    "string"
  );

  assert.ok(
    identity.publicKeyHex.length > 0
  );
});

test("fromPrivateKeyHex populates publicKeyHex", async () => {
  const identity =
    await PrivateIdentity.generate();

  const privateHex =
    await identity.exportPrivateHex();

  const restored =
    await PrivateIdentity.fromPrivateKeyHex(
      privateHex
    );

  assert.equal(
    typeof restored.publicKeyHex,
    "string"
  );

  assert.ok(
    restored.publicKeyHex.length > 0
  );
});

test("PublicIdentity.fromPublicHex recreates identical public key", async () => {
  const identity =
    await PrivateIdentity.generate();

  const publicHex =
    await identity.exportPublicHex();

  const publicIdentity =
    await PublicIdentity.fromPublicHex(
      publicHex
    );

  const importedBytes =
    await crypto.subtle.exportKey(
      "raw",
      publicIdentity.publicKey
    );

  const reconstructed =
    Buffer
      .from(importedBytes)
      .toString("hex");

  assert.equal(
    reconstructed,
    publicHex
  );
});

test("exportPublicBytes matches exportPublicHex", async () => {
  const identity =
    await PrivateIdentity.generate();

  const bytes =
    await identity.exportPublicBytes();

  const hex =
    await identity.exportPublicHex();

  const bytesHex =
    Buffer
      .from(bytes)
      .toString("hex");

  assert.equal(
    bytesHex,
    hex
  );
});