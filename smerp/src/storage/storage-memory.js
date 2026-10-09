// src/storage/storage-memory.js

// In-memory storage. Data is lost when the process exits.

import {
  StorageInterface,
} from "./storage-interface.js";

export class StorageMemory
  extends StorageInterface {

  constructor() {

    super();

    this.envelopes =
      new Map();

    this.conversations =
      new Map();

    this.relays =
      new Map();
  }

  async init() {}

  async close() {}

  // =========================================================
  // ENVELOPES
  // =========================================================

  async envelopesPut(record) {

    this.envelopes.set(
      record.uuid,
      structuredClone(record)
    );

    return record.uuid;
  }

  async envelopesGet(options = {}) {

    let results =
      Array.from(
        this.envelopes.values()
      );

    // =====================================================
    // FILTERS
    // =====================================================

    if (options.uuid) {

      results =
        results.filter(
          x => x.uuid === options.uuid
        );
    }

    if (options.publicKeyHex) {

      results =
        results.filter(
          x =>
            x.publicKeyHex ===
            options.publicKeyHex
        );
    }

    if (options.beforeTimestamp !== undefined) {

      results =
        results.filter(
          x =>
            x.timestamp <
            options.beforeTimestamp
        );
    }

    // =====================================================
    // SORT (newest first)
    // =====================================================

    results.sort(
      (a, b) =>
        b.timestamp - a.timestamp
    );

    // =====================================================
    // LIMIT
    // =====================================================

    if (options.limit) {

      results =
        results.slice(
          0,
          options.limit
        );
    }

    return structuredClone(results);
  }

  // =========================================================
  // CONVERSATIONS
  // =========================================================

  async conversationsPut(record) {

    this.conversations.set(
      record.publicKeyHex,
      structuredClone(record)
    );
    
    return record.publicKeyHex;
  }

  async conversationsGet(options = {}) {

    let results =
      Array.from(
        this.conversations.values()
      );

    if (options.publicKeyHex) {

      results =
        results.filter(
          x =>
            x.publicKeyHex ===
            options.publicKeyHex
        );
    }

    return structuredClone(results);
  }

  // =========================================================
  // RELAYS
  // =========================================================

  async relaysPut(record) {

    this.relays.set(
      record.relayUrl,
      structuredClone(record)
    );

    return record.relayUrl;
  }

  async relaysGet(options = {}) {

    let results =
      Array.from(
        this.relays.values()
      );

    if (options.relayUrl) {

      results =
        results.filter(
          x =>
            x.relayUrl ===
            options.relayUrl
        );
    }

    return structuredClone(results);
  }

  async relaysDelete({ relayUrl }) {

    return this.relays.delete(relayUrl) ? 1 : 0;
  }

}
