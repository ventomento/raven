
import { decrypt, PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";

// =====================================================
// Ingestor
// =====================================================

export class Ingestor {

  constructor({
    storage,
    identity,
    localPublicHex,
    logger,
    emit = null,
  }) {

    insist(identity, PrivateIdentity);
    insist(storage);
    insist(localPublicHex);
    insist(logger);

    this.storage = storage;
    this.identity = identity;
    this.localPublicHex = localPublicHex;
    this.logger = logger;
    this.emit = emit;
  }

  isIdentity(publicHex){
    
    return (this.localPublicHex === publicHex);

  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  async ingest(envelopeBytes) {
    this.logger.info("Ingestor: Ingest attempt:");

    insist(envelopeBytes, ArrayBuffer);

    const envelope = await decrypt({
      identity: this.identity,
      envelopeBytes
    });

    if ( await this.checkDuplicate(envelope.uuid) ) {
      return false;
    }

    await this.envelopePersist(
        await this.buildEnrichedEnvelope({
            envelope,
            receivedAt: Date.now(),
        })
    )
    
    return true;
  }

  async envelopePersist(envelope){
    await this.storage.envelopesPut(envelope);

    this.logger.info("Ingestor: ingest success:", {uuid: envelope.uuid});

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

    const outbound = this.isIdentity( envelope.senderPublicKeyHex );

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