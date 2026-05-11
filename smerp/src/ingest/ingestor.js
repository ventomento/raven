// src/ingest/envelope-ingestor.js

import {
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../../smep/src/index.js";

import { LagMonitor } from "../atx/lag-monitor.js";

export class Ingestor {

  constructor({
    storage,
    identity,
    emit = null,
  }) {

    this.storage = storage;
    this.identity = identity;
    this.emit = emit;
  }

  async getLocalPublicHex(){

    if ( this.localPublicHex === undefined ){
      this.localPublicHex = await this.identity.exportPublicHex();
    }
    
    return this.localPublicHex;
  }

  async isIdentity(publicHex){
    
    return (await this.getLocalPublicHex()) == publicHex;
  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  // return false on dublicate and true if inserted to storage.
  async ingest({
    envelopeBytes,
    relay = null,
    receivedAt = Date.now(),
  }) {

    const envelope = await decrypt(
      {recipient: this.identity, envelopeBytes}
    );

    if ( await this.checkDuplicate(envelope.uuid) ) {
      return false;
    }

    const enriched = await this.buildEnrichedEnvelope({
        envelope,
        relayUrl: relay?.relayUrl ?? null,
          receivedAt,
        });

    await this.storagePut({envelope: enriched, relay});
    this.emitEvents(enriched);

    return true;
  }

  async storagePut({envelope, relay}){
    await this.storage.envelopesPut(envelope);
    await this.upsertConversation(envelope);
    //update relays;
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

  async buildEnrichedEnvelope({
    envelope,
    relayUrl,
    receivedAt,
  }) {

    const outbound = await this.isIdentity( envelope.senderPublicKeyHex );

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

      lastMessageAt: 
        conversation.lastMessageAt > envelope.timestamp ? conversation.lastMessageAt : envelope.timestamp,
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


/* Record Models 

# relay record:
relayUrl
enabled
sid
lastSuccessAt
lastFailureAt
failureCount

# envelope record:
senderPublicKeyHex
recipientPublickeyHex
contentType
plaintext
timestamp
uuid
relayUrl,
receivedAt,

#conversation record:
publicKeyHex
unreadCount
lastMessageAt

*/