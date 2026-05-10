// src/storage/storage-adapter.js

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

  async relayStatesGet(options = {}) {
    throw new Error(
      "relayStatesGet() not implemented"
    );
  }

  async relayStatesPut(record) {
    throw new Error(
      "relayStatesPut() not implemented"
    );
  }

}