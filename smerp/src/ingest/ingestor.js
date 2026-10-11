import { decryptEnvelope, PrivateIdentity, readEnvelope, bytesToHex } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";
import { EventBus, EventTypes } from "../event/event-bus.js";
import { ConcurrencyLimiter } from "../sync/concurrency-limiter.js";
import { RealClock } from "../sync/rate-limiter.js";

export const IngestOutcome = Object.freeze({
  STORED: "stored",          // new envelope, persisted and announced
  DUPLICATE: "duplicate",    // already stored
  REJECTED: "rejected",      // malformed or undecryptable, never will be
});

// =====================================================
// Ingestor
// =====================================================

/**
 * Turns envelope bytes from a relay into stored records.
 *
 * ingest() resolves with { outcome, uuid, envelope?, reason? }:
 *   - a problem with the envelope itself resolves as REJECTED. Retrying
 *     gives the same result, so the caller should move past it.
 *   - a problem with the environment (storage) rejects the promise. The
 *     envelope is fine, so the caller should fetch it again later.
 *
 * Envelopes are unpacked before decryption so duplicates (the same
 * envelope from another relay) are dropped without decrypting them.
 */
export class Ingestor {

  constructor({
    storage,
    identity,
    eventBus,
    logger,
    clock = RealClock,
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
    this.clock = clock;
    // Last receivedAt handed out; see buildEnrichedEnvelope.
    this.lastReceivedAt = 0;
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

    let unpacked;

    try {
      unpacked = readEnvelope(envelopeBytes);
    }
    catch (error) {
      return this.rejected(null, error);
    }

    const uuid = bytesToHex(unpacked.uuid);

    // Fast path, outside the lock: most duplicates are caught here.
    if (await this.checkDuplicate(uuid)) {
      return { outcome: IngestOutcome.DUPLICATE, uuid };
    }

    let envelope;

    try {
      envelope = await decryptEnvelope({
        identity: this.identity,
        envelope: unpacked,
      });
    }
    catch (error) {
      return this.rejected(uuid, error);
    }

    const enrichedEnvelope = this.buildEnrichedEnvelope(envelope);

    const stored = await this.writeLock.run(async () => {

      if ( await this.checkDuplicate(uuid) ) {
        return false;
      }

      await this.envelopePersist(enrichedEnvelope);

      return true;
    });

    if (!stored) {
      return { outcome: IngestOutcome.DUPLICATE, uuid };
    }

    this.eventBus.publish({
      type: EventTypes.ENVELOPE,
      envelope: enrichedEnvelope,
    });

    return { outcome: IngestOutcome.STORED, uuid, envelope: enrichedEnvelope };
  }

  rejected(uuid, error) {

    this.logger.warn("Ingestor: envelope rejected:", { uuid, reason: error.message });

    return { outcome: IngestOutcome.REJECTED, uuid, reason: error.message };
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

  // Times in stored records are milliseconds since epoch, named ...At.
  // The wire timestamp (smep, seconds) becomes sentAt here.
  //
  // receivedAt is strictly increasing per client, so it orders envelopes
  // that share a sentAt second in the order they were fetched.
  buildEnrichedEnvelope(envelope) {

    const { timestamp, ...rest } = envelope;

    this.lastReceivedAt = Math.max(this.clock.now(), this.lastReceivedAt + 1);

    const outbound = this.isIdentity( envelope.senderPublicKeyHex );

    const publicKeyHex =
      outbound
        ? envelope.recipientPublicKeyHex
        : envelope.senderPublicKeyHex;

    return {
      ...rest,
      sentAt: timestamp * 1000,
      publicKeyHex,
      direction: outbound
        ? "outbound"
        : "inbound",
      receivedAt: this.lastReceivedAt,
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
        existingConversation.lastMessageAt > envelope.sentAt
          ? existingConversation.lastMessageAt
          : envelope.sentAt,
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
