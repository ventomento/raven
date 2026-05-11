// test/ingestor.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  Ingestor,
} from "../src/ingest/ingestor.js";

import {
  StorageMemory,
} from "../src/storage/storage-memory.js";

// ============================================================
// HELPERS
// ============================================================

function createEnvelope(overrides = {}) {

  return {
    senderPublicKeyHex:
      "sender-public-key",

    recipientPublickeyHex:
      "recipient-public-key",

    contentType:
      "text/plain",

    plaintext:
      "hello world",

    timestamp:
      Date.now(),

    uuid:
      crypto.randomUUID(),

    relayUrl:
      null,

    receivedAt:
      null,

    ...overrides,
  };
}

// ============================================================
// TESTS
// ============================================================

test(
  "ingest inserts inbound envelope and creates conversation",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const envelope =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          1000,
      });

    const result =
      await ingestor.ingest({
        envelope,

        relayUrl:
          "wss://relay.example",

        receivedAt:
          2000,
      });

    assert.equal(
      result.inserted,
      true
    );

    assert.equal(
      result.duplicate,
      false
    );

    assert.equal(
      result.envelope.direction,
      "inbound"
    );

    assert.equal(
      result.envelope.publicKeyHex,
      "remote-public-key"
    );

    assert.equal(
      result.envelope.read,
      false
    );

    assert.equal(
      result.envelope.relayUrl,
      "wss://relay.example"
    );

    assert.equal(
      result.envelope.receivedAt,
      2000
    );

    assert.deepEqual(
      result.conversation,
      {
        publicKeyHex:
          "remote-public-key",

        unreadCount:
          1,

        lastMessageAt:
          1000,
      }
    );

    const stored =
      await storage.envelopesGet({
        uuid:
          envelope.uuid,
      });

    assert.equal(
      stored.length,
      1
    );

    assert.equal(
      stored[0].uuid,
      envelope.uuid
    );
  }
);

test(
  "ingest inserts outbound envelope and creates conversation with zero unread count",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const envelope =
      createEnvelope({
        senderPublicKeyHex:
          "local-public-key",

        recipientPublickeyHex:
          "remote-public-key",

        timestamp:
          5000,
      });

    const result =
      await ingestor.ingest({
        envelope,
      });

    assert.equal(
      result.envelope.direction,
      "outbound"
    );

    assert.equal(
      result.envelope.publicKeyHex,
      "remote-public-key"
    );

    assert.equal(
      result.envelope.read,
      true
    );

    assert.deepEqual(
      result.conversation,
      {
        publicKeyHex:
          "remote-public-key",

        unreadCount:
          0,

        lastMessageAt:
          5000,
      }
    );
  }
);

test(
  "duplicate envelopes are rejected",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const envelope =
      createEnvelope();

    const first =
      await ingestor.ingest({
        envelope,
      });

    const second =
      await ingestor.ingest({
        envelope,
      });

    assert.equal(
      first.inserted,
      true
    );

    assert.equal(
      second.inserted,
      false
    );

    assert.equal(
      second.duplicate,
      true
    );

    const stored =
      await storage.envelopesGet();

    assert.equal(
      stored.length,
      1
    );
  }
);

test(
  "inbound messages increment unread count",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const first =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          1000,
      });

    const second =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          2000,
      });

    await ingestor.ingest({
      envelope:
        first,
    });

    const result =
      await ingestor.ingest({
        envelope:
          second,
      });

    assert.deepEqual(
      result.conversation,
      {
        publicKeyHex:
          "remote-public-key",

        unreadCount:
          2,

        lastMessageAt:
          2000,
      }
    );
  }
);

test(
  "outbound messages do not increment unread count",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const inbound =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          1000,
      });

    const outbound =
      createEnvelope({
        senderPublicKeyHex:
          "local-public-key",

        recipientPublickeyHex:
          "remote-public-key",

        timestamp:
          3000,
      });

    await ingestor.ingest({
      envelope:
        inbound,
    });

    const result =
      await ingestor.ingest({
        envelope:
          outbound,
      });

    assert.deepEqual(
      result.conversation,
      {
        publicKeyHex:
          "remote-public-key",

        unreadCount:
          1,

        lastMessageAt:
          3000,
      }
    );
  }
);

test(
  "conversation lastMessageAt keeps newest timestamp",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const newer =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          5000,
      });

    const older =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",

        timestamp:
          1000,
      });

    await ingestor.ingest({
      envelope:
        newer,
    });

    const result =
      await ingestor.ingest({
        envelope:
          older,
      });

    assert.equal(
      result.conversation.lastMessageAt,
      5000
    );
  }
);

test(
  "emitEvents emits message and conversationUpdated",
  async () => {

    const storage =
      new StorageMemory();

    const emitted = [];

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",

        emit(event, payload) {

          emitted.push({
            event,
            payload,
          });
        },
      });

    const envelope =
      createEnvelope({
        senderPublicKeyHex:
          "remote-public-key",

        recipientPublickeyHex:
          "local-public-key",
      });

    await ingestor.ingest({
      envelope,
    });

    assert.equal(
      emitted.length,
      2
    );

    assert.equal(
      emitted[0].event,
      "message"
    );

    assert.equal(
      emitted[1].event,
      "conversationUpdated"
    );

    assert.equal(
      emitted[0].payload.uuid,
      envelope.uuid
    );

    assert.equal(
      emitted[1].payload.publicKeyHex,
      "remote-public-key"
    );
  }
);

test(
  "buildEnrichedEnvelope returns frozen object",
  async () => {

    const storage =
      new StorageMemory();

    const ingestor =
      new Ingestor({
        storage,

        localPublicKeyHex:
          "local-public-key",
      });

    const enriched =
      ingestor.buildEnrichedEnvelope({
        envelope:
          createEnvelope(),

        relayUrl:
          "wss://relay.example",

        receivedAt:
          123,
      });

    assert.equal(
      Object.isFrozen(enriched),
      true
    );
  }
);