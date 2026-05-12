// test/smerp-client.roundtrip.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { SmerpClient } from "../src/smerp-client.js";

import {
  PrivateIdentity,
} from "../../smep/src/index.js";

// ============================================================
// ROUNDTRIP TEST
// ============================================================

test("smerp-client roundtrip encryptData -> ingest -> storage", async () => {

  // ==========================================================
  // CREATE CLIENT IDENTITIES
  // ==========================================================

  const aliceIdentity =
    await PrivateIdentity.generate();

  const bobIdentity =
    await PrivateIdentity.generate();

  // ==========================================================
  // CREATE CLIENTS
  // ==========================================================

  const alice = new SmerpClient({
    identity: aliceIdentity,
    debug: true,
  });

  const bob = new SmerpClient({
    identity: bobIdentity,
    debug: true,
  });

  // ==========================================================
  // EXPORT BOB PUBLIC KEY
  // ==========================================================

  const bobPublicHex =
    await bobIdentity.exportPublicHex();

  // ==========================================================
  // PLAINTEXT
  // ==========================================================

  const plaintext =
    "Hello Bob from Alice";

  // ==========================================================
  // ENCRYPT
  // ==========================================================

  const envelopeBytes =
    await alice.encryptData({
      publicKeyHex: bobPublicHex,
      data: plaintext,
    });

  assert.ok(
    envelopeBytes instanceof ArrayBuffer,
    "encryptData should return ArrayBuffer"
  );

  // ==========================================================
  // INGEST INTO BOB
  // ==========================================================

  await bob.ingest(envelopeBytes);

  // ==========================================================
  // FETCH ENVELOPES
  // ==========================================================

  const alicePublicHex =
    await aliceIdentity.exportPublicHex();

  const envelopes =
    await bob.envelopesGet(
      alicePublicHex
    );

  // ==========================================================
  // FETCH CONVERSATIONS
  // ==========================================================

  const conversations =
    await bob.conversationsGet();

  // ==========================================================
  // ASSERT RECORD COUNTS
  // ==========================================================

  assert.equal(
    envelopes.length,
    1,
    "should store exactly one envelope"
  );

  assert.equal(
    conversations.length,
    1,
    "should store exactly one conversation"
  );

  // ==========================================================
  // ENVELOPE ASSERTIONS
  // ==========================================================

  const envelope = envelopes[0];

  assert.equal(
    envelope.plaintext,
    plaintext,
    "plaintext should match"
  );

  assert.equal(
    envelope.senderPublicKeyHex,
    alicePublicHex,
    "sender should be Alice"
  );

  assert.equal(
    envelope.recipientPublicKeyHex,
    bobPublicHex,
    "recipient should be Bob"
  );

  assert.equal(
    envelope.publicKeyHex,
    alicePublicHex,
    "conversation key should be Alice"
  );

  assert.equal(
    envelope.direction,
    "inbound",
    "message should be inbound for Bob"
  );

  assert.equal(
    envelope.read,
    false,
    "inbound message should be unread"
  );

  assert.ok(
    typeof envelope.uuid === "string"
  );

  assert.ok(
    typeof envelope.timestamp === "bigint"
  );

  assert.ok(
    typeof envelope.receivedAt === "number"
  );

  // ==========================================================
  // CONVERSATION ASSERTIONS
  // ==========================================================

  const conversation =
    conversations[0];

  assert.equal(
    conversation.publicKeyHex,
    alicePublicHex,
    "conversation should belong to Alice"
  );

  assert.equal(
    conversation.unreadCount,
    1,
    "conversation unread count should be 1"
  );

  assert.equal(
    conversation.lastMessageAt,
    envelope.timestamp,
    "lastMessageAt should equal envelope timestamp"
  );

});


// ============================================================
// OUTBOUND CONVERSATION TEST
// ============================================================

test("client encrypts for recipient and ingests own outbound message", async () => {

  // ==========================================================
  // IDENTITIES
  // ==========================================================

  const aliceIdentity =
    await PrivateIdentity.generate();

  const bobIdentity =
    await PrivateIdentity.generate();

  // ==========================================================
  // CLIENT
  // ==========================================================

  const alice = new SmerpClient({
    identity: aliceIdentity,
    debug: true,
  });

  // ==========================================================
  // BOB PUBLIC HEX
  // ==========================================================

  const bobPublicHex =
    await bobIdentity.exportPublicHex();

  // ==========================================================
  // MESSAGE
  // ==========================================================

  const plaintext =
    "hello bob";

  // ==========================================================
  // ENCRYPT
  // ==========================================================

  const envelopeBytes =
    await alice.encryptData({
      publicKeyHex: bobPublicHex,
      data: plaintext,
    });
  console.log("b1");

  // ==========================================================
  // INGEST OWN OUTBOUND MESSAGE
  // ==========================================================

  console.log("b2");
  await alice.ingest(envelopeBytes);
  console.log("b3");
  // ==========================================================
  // FETCH STORAGE RECORDS
  // ==========================================================

  const conversations =
    await alice.conversationsGet();

  const envelopes =
    await alice.envelopesGet(
      bobPublicHex
    );

  // ==========================================================
  // ASSERT COUNTS
  // ==========================================================

  assert.equal(
    conversations.length,
    1,
    "should have exactly one conversation"
  );

  assert.equal(
    envelopes.length,
    1,
    "should have exactly one envelope"
  );

  // ==========================================================
  // ASSERT ENVELOPE
  // ==========================================================

  const envelope =
    envelopes[0];

  assert.equal(
    envelope.plaintext,
    plaintext
  );

  assert.equal(
    envelope.direction,
    "outbound"
  );

  assert.equal(
    envelope.read,
    true
  );

  assert.equal(
    envelope.publicKeyHex,
    bobPublicHex
  );

  // ==========================================================
  // ASSERT CONVERSATION
  // ==========================================================

  const conversation =
    conversations[0];

  assert.equal(
    conversation.publicKeyHex,
    bobPublicHex
  );

  assert.equal(
    conversation.unreadCount,
    0,
    "outbound conversation should have unreadCount 0"
  );

  assert.ok(
    typeof conversation.lastMessageAt === "bigint"
  );

});