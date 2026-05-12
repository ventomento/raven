// test/repl.js

import repl from "node:repl";

import { SmerpClient } from "../src/smerp-client.js";

import {
  PrivateIdentity,
  PublicIdentity,
  encrypt,
  decrypt,
} from "../../smep/src/index.js";

// ============================================================
// CREATE IDENTITIES
// ============================================================

const aliceIdentity =
  await PrivateIdentity.generate();

const bobIdentity =
  await PrivateIdentity.generate();

const charlieIdentity =
  await PrivateIdentity.generate();

// ============================================================
// CREATE CLIENTS
// ============================================================

const alice =
  new SmerpClient({
    identity: aliceIdentity,
    debug: true,
  });

const bob =
  new SmerpClient({
    identity: bobIdentity,
    debug: true,
  });

const charlie =
  new SmerpClient({
    identity: charlieIdentity,
    debug: true,
  });

// ============================================================
// EXPORT PUBLIC HEX
// ============================================================

const alicePublicHex =
  await aliceIdentity.exportPublicHex();

const bobPublicHex =
  await bobIdentity.exportPublicHex();

const charliePublicHex =
  await charlieIdentity.exportPublicHex();

// ============================================================
// EXPOSE GLOBALS
// ============================================================

Object.assign(globalThis, {

  // identities
  aliceIdentity,
  bobIdentity,
  charlieIdentity,

  // clients
  alice,
  bob,
  charlie,

  // public keys
  alicePublicHex,
  bobPublicHex,
  charliePublicHex,

  // crypto helpers
  encrypt,
  decrypt,
  PublicIdentity,
  PrivateIdentity,
});

// ============================================================
// START REPL
// ============================================================

console.log(`
============================================================
SMERP Interactive REPL
============================================================

Available globals:

alice
bob
charlie

aliceIdentity
bobIdentity
charlieIdentity

alicePublicHex
bobPublicHex
charliePublicHex

encrypt
decrypt

Example:

const buf = await alice.encryptData({
  publicKeyHex: bobPublicHex,
  data: "hello bob"
})

await alice.ingest(buf)

await alice.conversationsGet()

await alice.envelopesGet(bobPublicHex)

============================================================
`);

repl.start({
  prompt: "smerp> ",
  useGlobal: true,
});