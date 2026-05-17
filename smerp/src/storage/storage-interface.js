// src/storage/storage-interface.js

// All "Get" operations must return a list of js objects (maps/dicts).
// If no records return empty list.

// envelopes must be keyed by uuid.
// conversations must be keyed by publicKeyHex.
// relays must be keyed by relayUrl.

// with keyed meaning unique field and record retrievable by key.

export class StorageInterface {

  // =========================================================
  // ENVELOPES
  // =========================================================

  async envelopesGet(options = {}) {
    throw new Error(
      "envelopesGet() not implemented"
    );
  }

  async envelopesPut(record) {
    throw new Error(
      "envelopesPut() not implemented"
    );
  }

  // =========================================================
  // CONVERSATIONS
  // =========================================================

  async conversationsGet(options = {}) {
    throw new Error(
      "conversationsGet() not implemented"
    );
  }

  async conversationsPut(record) {
    throw new Error(
      "conversationsPut() not implemented"
    );
  }

  // =========================================================
  // RELAY STATES
  // =========================================================

  async relaysGet(options = {}) {
    throw new Error(
      "relaysGet() not implemented"
    );
  }

  async relaysPut(record) {
    throw new Error(
      "relaysPut() not implemented"
    );
  }
  
  async relaysSeed(list) {
    throw new Error(
      "relaysSeed() not implemented"
    );
  }

}