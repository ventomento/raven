// test/smerp-client.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity } from "../../smep/src/index.js";
import { SmerpClient } from "../src/smerp-client.js";

test(
  "SmerpClient supports bidirectional encrypted conversations correctly",
  async () => {

    // =====================================================
    // CREATE IDENTITIES
    // =====================================================

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();

    const aliceHex = await alice.exportPublicHex();
    const bobHex = await bob.exportPublicHex();

    // =====================================================
    // CLIENTS (each represents a user)
    // =====================================================

    const aliceClient = new SmerpClient({
      identity: alice,
      debug: false,
    });

    const bobClient = new SmerpClient({
      identity: bob,
      debug: false,
    });

    // =====================================================
    // MESSAGE 1: BOB → ALICE
    // =====================================================

    const msg1 = "hello alice from bob";

    const envelope1 =
      await bobClient.encryptData({
        publicKeyHex: aliceHex, // destination = Alice
        data: msg1,
      });

    await aliceClient.ingest(envelope1);

    // =====================================================
    // VERIFY ALICE RECEIVED MESSAGE
    // =====================================================

    const aliceEnvelopes =
      await aliceClient.envelopesGet(aliceHex);

    assert.equal(aliceEnvelopes.length, 1);

    assert.equal(
      aliceEnvelopes[0].direction,
      "inbound"
    );

    assert.equal(
      aliceEnvelopes[0].publicKeyHex,
      bobHex, // conversation partner = Bob
      "Alice conversation should be Bob"
    );

    // =====================================================
    // MESSAGE 2: ALICE → BOB
    // =====================================================

    const msg2 = "hello bob from alice";

    const envelope2 =
      await aliceClient.encryptData({
        publicKeyHex: bobHex, // destination = Bob
        data: msg2,
      });

    await bobClient.ingest(envelope2);

    // =====================================================
    // VERIFY BOB RECEIVED MESSAGE
    // =====================================================

    const bobEnvelopes =
      await bobClient.envelopesGet(bobHex);

    assert.equal(bobEnvelopes.length, 1);

    assert.equal(
      bobEnvelopes[0].direction,
      "inbound"
    );

    assert.equal(
      bobEnvelopes[0].publicKeyHex,
      aliceHex, // conversation partner = Alice
      "Bob conversation should be Alice"
    );

    // =====================================================
    // VERIFY CONVERSATIONS (ALICE SIDE)
    // =====================================================

    const aliceConversations =
      await aliceClient.conversationsGet();

    assert.equal(aliceConversations.length, 1);

    assert.equal(
      aliceConversations[0].publicKeyHex,
      bobHex,
      "Alice conversation is Bob"
    );

    assert.equal(
      aliceConversations[0].unreadCount,
      1,
      "Alice should have 1 unread message"
    );

    // =====================================================
    // VERIFY CONVERSATIONS (BOB SIDE)
    // =====================================================

    const bobConversations =
      await bobClient.conversationsGet();

    assert.equal(bobConversations.length, 1);

    assert.equal(
      bobConversations[0].publicKeyHex,
      aliceHex,
      "Bob conversation is Alice"
    );

    assert.equal(
      bobConversations[0].unreadCount,
      1,
      "Bob should have 1 unread message"
    );
  }
);

//add 
test(
  "SmerpClient correctly handles multiple conversations and unread counts",
  async () => {

    // =====================================================
    // IDENTITIES
    // =====================================================

    const bob = await PrivateIdentity.generate();
    const alice = await PrivateIdentity.generate();
    const carol = await PrivateIdentity.generate();

    const bobHex = await bob.exportPublicHex();
    const aliceHex = await alice.exportPublicHex();
    const carolHex = await carol.exportPublicHex();

    // =====================================================
    // CLIENT (Bob is sender in this test)
    // =====================================================

    const bobClient = new SmerpClient({
      identity: bob,
      debug: false,
    });

    // =====================================================
    // MESSAGE 1: BOB → ALICE
    // =====================================================

    const msg1 =
      await bobClient.encryptData({
        publicKeyHex: aliceHex,
        data: "hello alice 1",
      });

    await bobClient.ingest(msg1);

    // =====================================================
    // MESSAGE 2: BOB → CAROL
    // =====================================================

    const msg2 =
      await bobClient.encryptData({
        publicKeyHex: carolHex,
        data: "hello carol 1",
      });

    await bobClient.ingest(msg2);

    // =====================================================
    // MESSAGE 3: BOB → ALICE (again)
    // =====================================================

    const msg3 =
      await bobClient.encryptData({
        publicKeyHex: aliceHex,
        data: "hello alice 2",
      });

    await bobClient.ingest(msg3);

    // =====================================================
    // FETCH CONVERSATIONS
    // =====================================================

    const conversations =
      await bobClient.conversationsGet();

    // should have 2 conversations (Alice + Carol)
    assert.equal(
      conversations.length,
      2,
      "should create one conversation per unique recipient"
    );

    // =====================================================
    // FIND CONVERSATIONS
    // =====================================================

    const aliceConv =
      conversations.find(
        c => c.publicKeyHex === aliceHex
      );

    const carolConv =
      conversations.find(
        c => c.publicKeyHex === carolHex
      );

    assert.ok(aliceConv, "Alice conversation exists");
    assert.ok(carolConv, "Carol conversation exists");

    // =====================================================
    // VERIFY UNREAD COUNTS
    // =====================================================

    // Alice got 2 messages
    assert.equal(
      aliceConv.unreadCount,
      2,
      "Alice should have 2 unread messages"
    );

    // Carol got 1 message
    assert.equal(
      carolConv.unreadCount,
      1,
      "Carol should have 1 unread message"
    );

    // =====================================================
    // VERIFY INDEPENDENT STATE ISOLATION
    // =====================================================

    assert.notEqual(
      aliceConv.lastMessageAt,
      undefined,
      "Alice conversation should have timestamp"
    );

    assert.notEqual(
      carolConv.lastMessageAt,
      undefined,
      "Carol conversation should have timestamp"
    );

    // Carol should NOT be affected by Alice messages
    assert.equal(
      carolConv.unreadCount,
      1
    );

    assert.equal(
      aliceConv.unreadCount,
      2
    );
  }
);