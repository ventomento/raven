// src/storage/storage-adapter.js

// All "Get" operations must return a list of js objects (maps/dicts).

// envelopes must be keyed by uuid.
// conversations must be keyed by publicKeyHex.
// relays must be keyed by relayUrl.

export class StorageInterface {

  async initialize() {
    throw new Error(
      "initialize() not implemented"
    );
  }

  async close() {
    throw new Error(
      "close() not implemented"
    );
  }

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