// test/smerp-client.diagnostic.test.js

import { PrivateIdentity } from "../../smep/src/index.js";
import { SmerpClient } from "../src/smerp-client.js";

async function run() {
  console.log("\n🧪 SmerpClient DIAGNOSTIC START\n");

  // =====================================================
  // CREATE IDENTITIES
  // =====================================================

  const alice = await PrivateIdentity.generate();
  const bob = await PrivateIdentity.generate();

  const aliceHex = await alice.exportPublicHex();
  const bobHex = await bob.exportPublicHex();

  console.log("👤 Alice:", aliceHex);
  console.log("👤 Bob  :", bobHex);

  // =====================================================
  // CREATE CLIENT (Bob is receiver)
  // =====================================================

  const client = new SmerpClient({
    identity: bob,
    debug: true,
  });

  console.log("\n📦 Client created (Bob identity)\n");

  // =====================================================
  // STEP 1: ENCRYPT MESSAGE (Alice → Bob)
  // =====================================================

  const message = "hello debug world";

  const envelopeBytes = await client.encryptData({
    publicKeyHex: bobHex,
    data: message,
  });

  console.log("🔐 Encrypted envelope created");
  console.log("   bytes length:", envelopeBytes?.length);

  // =====================================================
  // STEP 2: INGEST
  // =====================================================

  console.log("\n📥 Ingesting envelope...\n");

  await client.ingest(envelopeBytes);

  // =====================================================
  // STEP 3: INSPECT ENVELOPES
  // =====================================================

  const envelopes = await client.envelopesGet(bobHex);

  console.log("📦 Envelopes in storage:");
  console.dir(envelopes, { depth: null });

  if (envelopes.length > 0) {
    const e = envelopes[0];

    console.log("\n🔎 Envelope breakdown:");
    console.log("sender   :", e.senderPublicKeyHex);
    console.log("recipient:", e.recipientPublicKeyHex);
    console.log("me (bob) :", bobHex);
    console.log("direction:", e.direction);
    console.log("publicKey:", e.publicKeyHex);
    console.log("receivedAt:", e.receivedAt);
  }

  // =====================================================
  // STEP 4: INSPECT CONVERSATIONS
  // =====================================================

  const conversations = await client.conversationsGet();

  console.log("\n💬 Conversations:");
  console.dir(conversations, { depth: null });

  if (conversations.length > 0) {
    const c = conversations[0];

    console.log("\n🧠 Conversation analysis:");
    console.log("publicKeyHex :", c.publicKeyHex);
    console.log("unreadCount   :", c.unreadCount);
    console.log("lastMessageAt :", c.lastMessageAt);
  }

  // =====================================================
  // STEP 5: MANUAL DIAGNOSIS
  // =====================================================

  console.log("\n🧪 DIAGNOSIS CHECKS:\n");

  const e = envelopes[0];
  const c = conversations[0];

  console.log("→ is inbound message?");
  console.log("   direction =", e?.direction);

  console.log("\n→ identity comparison:");
  console.log("   sender  =", e?.senderPublicKeyHex);
  console.log("   bob     =", bobHex);

  console.log(
    "   matches?",
    e?.senderPublicKeyHex === bobHex
  );

  console.log("\n→ conversation link:");
  console.log("   conversation.publicKeyHex =", c?.publicKeyHex);

  console.log("\n→ unread logic expectation:");
  console.log("   inbound should => unreadCount = 1");

  console.log("\n🧪 DIAGNOSTIC END\n");
}

run().catch((err) => {
  console.error("❌ Diagnostic failed:");
  console.error(err);
});