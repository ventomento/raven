// =====================================================
// Ingestor
// =====================================================

class Ingestor {

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
    
    return (await this.getLocalPublicHex()) === publicHex;
  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  async ingest(
    envelopeBytes
  ){

    insist(envelopeBytes, ArrayBuffer);

    const receivedAt = Date.now();

    const envelope = await decrypt({
      identity: this.identity,
      envelopeBytes
    });

    if ( await this.checkDuplicate(envelope.uuid) ) {
      return false;
    }

    const enriched = await this.buildEnrichedEnvelope({
        envelope,
        receivedAt,
        });

    await this.storagePut(enriched);
    return true;
  }

  async storagePut(envelope){
    await this.storage.envelopesPut(envelope);
    await this.upsertConversation(envelope);
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
    receivedAt,
  }) {

    const outbound = await this.isIdentity( envelope.senderPublicKeyHex );

    const publicKeyHex =
      outbound
        ? envelope.recipientPublicKeyHex
        : envelope.senderPublicKeyHex;

    return {
      ...envelope,
      publicKeyHex,
      direction: outbound
        ? "outbound"
        : "inbound",
      receivedAt,
      read: outbound,
    };
  }

  // =====================================================
  // CONVERSATION LOGIC
  // =====================================================

  async upsertConversation(envelope) {

    const publicKeyHex = envelope.publicKeyHex;

    const [existingConversation] =
      await this.storage.conversationsGet({
        publicKeyHex,
        limit: 1,
      });

    const conversation = {
      ...(existingConversation ?? {}),

      publicKeyHex,

      unreadCount:
        (existingConversation?.unreadCount ?? 0) +
        (envelope.direction === "outbound" ? 0 : 1),

      lastMessageAt:
        existingConversation &&
        existingConversation.lastMessageAt > envelope.timestamp
          ? existingConversation.lastMessageAt
          : envelope.timestamp,
    };

    await this.storage.conversationsPut(conversation);

    return conversation;
  } 

}