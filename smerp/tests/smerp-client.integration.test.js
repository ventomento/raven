import test from "node:test";
import assert from "node:assert/strict";

import { SmerpClient }
  from "../src/smerp-client.js";

import { PrivateIdentity }
  from "../../smep/src/index.js";

/**
 * Minimal integration-test storage
 */
class TestStorage {

  constructor() {
    this.envelopes = [];
    this.conversations = [];
    this.relays = [];
  }

  // =====================================================
  // ENVELOPES
  // =====================================================

  async envelopesPut(envelope) {
    this.envelopes.push(envelope);
  }

  async envelopesGet({ uuid }) {
    return this.envelopes.filter(
      e => e.uuid === uuid
    );
  }

  // =====================================================
  // CONVERSATIONS
  // =====================================================

  async conversationsPut(conversation) {

    const idx =
      this.conversations.findIndex(
        c =>
          c.publicKeyHex ===
          conversation.publicKeyHex
      );

    if (idx >= 0) {
      this.conversations[idx] =
        conversation;
    } else {
      this.conversations.push(
        conversation
      );
    }
  }

  async conversationsGet({
    publicKeyHex
  }) {

    return this.conversations.filter(
      c => c.publicKeyHex === publicKeyHex
    );
  }

  // =====================================================
  // RELAYS
  // =====================================================

  async relaysPut(relay) {
    this.relays.push(relay);
  }
}

/**
 * Mock transport
 */
async function transport() {

  return {
    status: 200,
    headers: {},
    body: null,
  };
}

test(
  "encrypt + ingest envelope successfully",
  async () => {

    const storage =
      new TestStorage();

    const alice =
      await PrivateIdentity.generate();

    const bob =
      await PrivateIdentity.generate();

    const bobPublicHex =
      await bob.exportPublicHex();

    const client =
      new SmerpClient({
        identity: bob,
        transport,
        storage,
      });

    const plaintext =
      new TextEncoder().encode(
        "hello world"
      );

    const envelopeBytes =
      await client.encryptData(
        bobPublicHex,
        plaintext
      );

    assert.ok(envelopeBytes);

    const inserted =
      await client.ingestor.ingest({
        envelopeBytes,
        relay: {
          relayUrl:
            "https://relay.example"
        },
      });

    assert.equal(inserted, true);

    assert.equal(
      storage.envelopes.length,
      1
    );

    const envelope =
      storage.envelopes[0];

    assert.ok(envelope.uuid);

    assert.equal(
      envelope.relayUrl,
      "https://relay.example"
    );

    assert.ok(
      envelope.receivedAt
    );

    assert.equal(
      storage.conversations.length,
      1
    );
  }
);

test(
  "duplicate envelope is rejected",
  async () => {

    const storage =
      new TestStorage();

    const identity =
      await PrivateIdentity.generate();

    const publicHex =
      await identity.exportPublicHex();

    const client =
      new SmerpClient({
        identity,
        transport,
        storage,
      });

    const plaintext =
      new TextEncoder().encode(
        "duplicate test"
      );

    const envelopeBytes =
      await client.encryptData(
        publicHex,
        plaintext
      );

    const first =
      await client.ingestor.ingest({
        envelopeBytes,
      });

    const second =
      await client.ingestor.ingest({
        envelopeBytes,
      });

    assert.equal(first, true);

    assert.equal(second, false);

    assert.equal(
      storage.envelopes.length,
      1
    );
  }
);

test(
  "multiple encrypted messages ingest correctly",
  async () => {

    const storage =
      new TestStorage();

    const identity =
      await PrivateIdentity.generate();

    const publicHex =
      await identity.exportPublicHex();

    const client =
      new SmerpClient({
        identity,
        transport,
        storage,
      });

    const messages = [
      "message one",
      "message two",
      "message three",
    ];

    for (const message of messages) {

      const plaintext =
        new TextEncoder().encode(
          message
        );

      const envelopeBytes =
        await client.encryptData(
          publicHex,
          plaintext
        );

      const inserted =
        await client.ingestor.ingest({
          envelopeBytes,
        });

      assert.equal(inserted, true);
    }

    assert.equal(
      storage.envelopes.length,
      3
    );

    assert.equal(
      storage.conversations.length,
      1
    );
  }
);

test(
  "invalid public key fails encryption",
  async () => {

    const identity =
      await PrivateIdentity.generate();

    const client =
      new SmerpClient({
        identity,
        transport,
      });

    const invalidPublicHex =
      "deadbeef";

    const plaintext =
      new TextEncoder().encode(
        "invalid key test"
      );

    await assert.rejects(
      async () => {

        await client.encryptData(
          invalidPublicHex,
          plaintext
        );

      }
    );
  }
);

test(
  "cannot ingest corrupted envelope",
  async () => {

    const storage =
      new TestStorage();

    const identity =
      await PrivateIdentity.generate();

    const client =
      new SmerpClient({
        identity,
        transport,
        storage,
      });

    const corrupted =
      crypto.getRandomValues(
        new Uint8Array(128)
      );

    await assert.rejects(
      async () => {

        await client.ingestor.ingest({
          envelopeBytes: corrupted,
        });

      }
    );

    assert.equal(
      storage.envelopes.length,
      0
    );
  }
);