// test/smerp-client.single-ingest.diagnostic.js

import { PrivateIdentity } from "../../smep/src/index.js";
import { SmerpClient } from "../src/smerp-client.js";

async function run() {

  console.log("\n🧪 SINGLE CLIENT INGEST DIAGNOSTIC\n");

  // =====================================================
  // IDENTITIES
  // =====================================================

  const bob = await PrivateIdentity.generate();
  const alice = await PrivateIdentity.generate();

  const bobHex = await bob.exportPublicHex();
  const aliceHex = await alice.exportPublicHex();

  console.log("👤 Bob  :", bobHex);
  console.log("👤 Alice:", aliceHex);

  // =====================================================
  // CLIENT (Bob only)
  // =====================================================

  const bobClient = new SmerpClient({
    identity: bob,
    debug: true,
  });

  console.log("\n📦 Bob client initialized\n");

  // =====================================================
  // STEP 1: BOB encrypts message to ALICE
  // =====================================================

  const message = "hello alice from bob";

  const envelopeBytes =
    await bobClient.encryptData({
      publicKeyHex: aliceHex, // destination = Alice
      data: message,
    });

  console.log("✔ encrypted message to Alice");

  // =====================================================
  // STEP 2: INGEST INTO BOB CLIENT (local simulation)
  // =====================================================

  console.log("\n📥 ingesting into Bob client...\n");

  await bobClient.ingest(envelopeBytes);

  // =====================================================
  // STEP 3: PRINT ENVELOPES
  // =====================================================

  const envelopes =
    await bobClient.envelopesGet(bobHex);

  console.log("\n📦 ENVELOPES:");
  console.dir(envelopes, { depth: null });

  // =====================================================
  // STEP 4: PRINT CONVERSATIONS
  // =====================================================

  const conversations =
    await bobClient.conversationsGet();

  console.log("\n💬 CONVERSATIONS:");
  console.dir(conversations, { depth: null });

  // =====================================================
  // STEP 5: INTERPRETATION HELP
  // =====================================================

  if (Array.isArray(envelopes) && envelopes.length > 0) {

    const e = envelopes[0];

    console.log("\n🔎 ENVELOPE ANALYSIS:");
    console.log("sender   :", e.senderPublicKeyHex);
    console.log("recipient:", e.recipientPublicKeyHex);
    console.log("direction:", e.direction);
    console.log("publicKey:", e.publicKeyHex);
    console.log("plaintext :", e.plaintext);
  }

  if (Array.isArray(conversations)) {

    for (const c of conversations) {
      console.log("\n💬 CONVERSATION ANALYSIS:");
      console.log("key         :", c.publicKeyHex);
      console.log("unreadCount :", c.unreadCount);
      console.log("lastMessage :", c.lastMessageAt);
    }
  }

  console.log("\n🧪 DIAGNOSTIC COMPLETE\n");
}

run().catch((err) => {
  console.error("\n❌ DIAGNOSTIC FAILED\n");
  console.error(err);
});