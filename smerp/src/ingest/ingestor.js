
import { decrypt, PrivateIdentity } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { ConcurrencyLimiter } from "../sync/concurrency-limiter.js";

// =====================================================
// Ingestor
// =====================================================

export class Ingestor {

  constructor({
    storage,
    identity,
    eventBus,
    logger,
  }) {

    insist(identity, PrivateIdentity);
    insist(storage);
    insist(eventBus, EventBus);
    insist(logger);

    this.storage = storage;
    this.identity = identity;
    this.localPublicHex = this.identity.publicKeyHex;
    this.eventBus = eventBus;
    this.logger = logger;
    // Serializes dedup check + persist. Relays are synced in parallel and
    // every envelope is on every relay, so the same envelope can be
    // ingested twice at once; without this both copies pass the dedup
    // check and the envelope is announced and unread-counted twice.
    this.writeLock = new ConcurrencyLimiter(1);
  }

  isIdentity(publicHex){
    
    return (this.localPublicHex === publicHex);

  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  async ingest(envelopeBytes) {

    insist(envelopeBytes, ArrayBuffer);

    const envelope = await decrypt({
      identity: this.identity,
      envelopeBytes
    });

    const enrichedEnvelope = 
      await this.buildEnrichedEnvelope({
          envelope,
      })

    const stored = await this.writeLock.run(async () => {

      if ( await this.checkDuplicate(envelope.uuid) ) {
        return false;
      }

      await this.envelopePersist(enrichedEnvelope);

      return true;
    });

    if (!stored) {
      return false;
    }

    this.eventBus.publish({
      type: EventTypes.ENVELOPE,
      envelope: enrichedEnvelope,
    });

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
      receivedAt: Date.now() / 1000, //second since epoc.
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

    if (! await this.storage.conversationsPut(conversation)) {
      return false;
    }

    this.eventBus.publish({
      type: EventTypes.CONVERSATION,
      conversation,
      created: !existingConversation,
    });

    return conversation;
  } 

}