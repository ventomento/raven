// src/ingest/envelope-ingestor.js


import {
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../smep/src/index.js";

export class Ingestor {

  constructor({
    storage,
    identity,
    localPublicKeyHex,
    emit = null,
  }) {

    this.storage = storage;
    this.localPublicKeyHex = localPublicKeyHex;
    this.emit = emit;
  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  async ingest({
    envelope,
    relayUrl = null,
    receivedAt = Date.now(),
  }) {

    # decrypt Headers.

    if ( await this.checkDuplicate(envelope.uuid) ) {
      return {
        inserted: false,
        duplicate: true,
      };
    }

    const enriched =
      this.buildEnrichedEnvelope({
        envelope,
        relayUrl,
        receivedAt,
      });

    await this.storage.envelopesPut(envelope);
    const conversation = await this.upsertConversation(enriched);

    this.emitEvents(enriched, conversation);

    return {
      inserted: true,
      duplicate: false,
      envelope: enriched,
      conversation,
    };
  }

  // =====================================================
  // DEDUP
  // =====================================================

  async checkDuplicate(uuid) {

    const existing =
      await this.storage.envelopesGet({
        uuid,
        limit: 1,
      });

    return existing.length > 0;
  }

  // =====================================================
  // ENRICHMENT
  // =====================================================

  buildEnrichedEnvelope({
    envelope,
    relayUrl,
    receivedAt,
  }) {

    const outbound = (envelope.senderPublicKeyHex === this.localPublicKeyHex);

    const publicKeyHex =
      outbound
        ? envelope.recipientPublickeyHex
        : envelope.senderPublicKeyHex;

    return Object.freeze({
      ...envelope,

      publicKeyHex,

      direction: outbound
        ? "outbound"
        : "inbound",

      relayUrl,

      receivedAt,

      read: outbound,
    });
  }

  // =====================================================
  // CONVERSATION LOGIC
  // =====================================================

  async upsertConversation(envelope) {

    const publicKeyHex =
      envelope.publicKeyHex;

    const conversations =
      await this.storage.conversationsGet({
        publicKeyHex,
        limit: 1,
      });

    let conversation =
      conversations[0];

    if (!conversation) {
      conversation = this.createConversation(envelope);
    } else {
      conversation = this.updateConversation(
        conversation,
        envelope
      );
    }

    await this.storage.conversationsPut(
      conversation
    );

    return conversation;
  }

  createConversation(envelope) {

    return {
      publicKeyHex:
        envelope.publicKeyHex,

      unreadCount:
        envelope.direction === "inbound"
          ? 1
          : 0,

      lastMessageAt:
        envelope.timestamp,
    };
  }

  updateConversation(conversation, envelope) {

    const isOutbound =
      envelope.direction === "outbound";

    return {
      ...conversation,

      unreadCount:
        isOutbound
          ? conversation.unreadCount
          : conversation.unreadCount + 1,

      lastMessageAt: Math.max(
        conversation.lastMessageAt,
        envelope.timestamp
      ),
    };
  }

  // =====================================================
  // EVENTS
  // =====================================================

  emitEvents(envelope, conversation) {

    if (!this.emit) return;

    this.emit("message", envelope);

    this.emit("conversationUpdated", conversation);
  }
}