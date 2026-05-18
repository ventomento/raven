// src/storage/storage-memory.js

//  Mock module for testing. Do not use in production.

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

  async initialize() {}

  async close() {}

  // =========================================================
  // ENVELOPES
  // =========================================================

  async envelopesPut(envelope) {

    this.envelopes.set(
      envelope.uuid,
      envelope
    );
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
            x.remotePublicKeyHex ===
            options.publicKeyHex
        );
    }

    if (options.before) {

      results =
        results.filter(
          x =>
            x.createdAt <
            options.before
        );
    }

    // =====================================================
    // SORT
    // =====================================================

    results.sort(
      (a, b) =>
        b.createdAt - a.createdAt
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

    return results;
  }

  // =========================================================
  // CONVERSATIONS
  // =========================================================

  async conversationsPut(record) {

    this.conversations.set(
      record.publicKeyHex,
      record
    );
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

    results.sort(
      (a, b) =>
        b.lastMessageAt -
        a.lastMessageAt
    );

    if (options.limit) {

      results =
        results.slice(
          0,
          options.limit
        );
    }

    return results;
  }

  // =========================================================
  // RELAY
  // =========================================================

  async relaysPut(record) {

    this.relays.set(
      record.relayUrl,
      record
    );
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

    return results;
  }

}