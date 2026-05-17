// src/storage/storage-indexeddb.js

import {
  StorageInterface,
} from "./storage-interface.js";

const DB_NAME =
  "app-storage";

const DB_VERSION =
  1;

const STORE_ENVELOPES =
  "envelopes";

const STORE_CONVERSATIONS =
  "conversations";

const STORE_RELAYS =
  "relays";

export class StorageIndexedDb
  extends StorageInterface {

  constructor() {

    super();

    this.db = null;
  }

  // =========================================================
  // LIFECYCLE
  // =========================================================

  async initialize() {

    this.db =
      await this.#openDatabase();
  }

  async close() {

    if (this.db) {

      this.db.close();

      this.db = null;
    }
  }

  async #openDatabase() {

    return new Promise(
      (resolve, reject) => {

        const request =
          indexedDB.open(
            DB_NAME,
            DB_VERSION
          );

        request.onerror =
          () =>
            reject(
              request.error
            );

        request.onsuccess =
          () =>
            resolve(
              request.result
            );

        request.onupgradeneeded =
          event => {

            const db =
              event.target.result;

            // =================================================
            // ENVELOPES
            // =================================================

            if (
              !db.objectStoreNames.contains(
                STORE_ENVELOPES
              )
            ) {

              const store =
                db.createObjectStore(
                  STORE_ENVELOPES,
                  {
                    keyPath:
                      "uuid",
                  }
                );

              // Main conversation query index.
              // Query pattern:
              // publicKeyHex + timestamp
              store.createIndex(
                "publicKeyTimestamp",
                [
                  "publicKeyHex",
                  "timestamp",
                ],
                {
                  unique: false,
                }
              );

              store.createIndex(
                "timestamp",
                "timestamp",
                {
                  unique: false,
                }
              );

              store.createIndex(
                "receivedAt",
                "receivedAt",
                {
                  unique: false,
                }
              );

              store.createIndex(
                "relayUrl",
                "relayUrl",
                {
                  unique: false,
                }
              );
            }

            // =================================================
            // CONVERSATIONS
            // =================================================

            if (
              !db.objectStoreNames.contains(
                STORE_CONVERSATIONS
              )
            ) {

              const store =
                db.createObjectStore(
                  STORE_CONVERSATIONS,
                  {
                    keyPath:
                      "publicKeyHex",
                  }
                );

              store.createIndex(
                "lastMessageAt",
                "lastMessageAt",
                {
                  unique: false,
                }
              );
            }

            // =================================================
            // RELAYS
            // =================================================

            if (
              !db.objectStoreNames.contains(
                STORE_RELAYS
              )
            ) {

              db.createObjectStore(
                STORE_RELAYS,
                {
                  keyPath:
                    "relayUrl",
                }
              );
            }
          };
      }
    );
  }

  // =========================================================
  // INTERNAL HELPERS
  // =========================================================

  #store(
    storeName,
    mode = "readonly"
  ) {

    return this.db
      .transaction(
        storeName,
        mode
      )
      .objectStore(
        storeName
      );
  }

  #request(request) {

    return new Promise(
      (resolve, reject) => {

        request.onsuccess =
          () =>
            resolve(
              request.result
            );

        request.onerror =
          () =>
            reject(
              request.error
            );
      }
    );
  }

  // =========================================================
  // ENVELOPES
  // =========================================================

  async envelopesPut(record) {

    const store =
      this.#store(
        STORE_ENVELOPES,
        "readwrite"
      );

    await this.#request(
      store.put(record)
    );
  }

  async envelopesGet(
    options = {}
  ) {

    const store =
      this.#store(
        STORE_ENVELOPES
      );

    // =====================================================
    // UUID LOOKUP
    // =====================================================

    if (options.uuid) {

      const result =
        await this.#request(
          store.get(
            options.uuid
          )
        );

      return result
        ? [result]
        : [];
    }

    // =====================================================
    // CONVERSATION QUERY
    // =====================================================

    if (
      options.publicKeyHex
    ) {

      const index =
        store.index(
          "publicKeyTimestamp"
        );

      const upperTimestamp =
        options.before ??
        Number.MAX_SAFE_INTEGER;

      const range =
        IDBKeyRange.bound(
          [
            options.publicKeyHex,
            0,
          ],
          [
            options.publicKeyHex,
            upperTimestamp,
          ]
        );

      return new Promise(
        (
          resolve,
          reject
        ) => {

          const results =
            [];

          const request =
            index.openCursor(
              range,
              "prev"
            );

          request.onerror =
            () =>
              reject(
                request.error
              );

          request.onsuccess =
            event => {

              const cursor =
                event.target.result;

              // Done
              if (
                !cursor
              ) {

                resolve(
                  results
                );

                return;
              }

              // Limit reached
              if (
                options.limit &&
                results.length >=
                  options.limit
              ) {

                resolve(
                  results
                );

                return;
              }

              results.push(
                cursor.value
              );

              cursor.continue();
            };
        }
      );
    }

    // =====================================================
    // FALLBACK
    // =====================================================

    return [];
  }

  // =========================================================
  // CONVERSATIONS
  // =========================================================

  async conversationsPut(
    record
  ) {

    const store =
      this.#store(
        STORE_CONVERSATIONS,
        "readwrite"
      );

    await this.#request(
      store.put(record)
    );
  }

  async conversationsGet(
    options = {}
  ) {

    const store =
      this.#store(
        STORE_CONVERSATIONS
      );

    // =====================================================
    // SINGLE LOOKUP
    // =====================================================

    if (
      options.publicKeyHex
    ) {

      const result =
        await this.#request(
          store.get(
            options.publicKeyHex
          )
        );

      return result
        ? [result]
        : [];
    }

    // =====================================================
    // RECENT CONVERSATIONS
    // =====================================================

    const index =
      store.index(
        "lastMessageAt"
      );

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const results =
          [];

        const request =
          index.openCursor(
            null,
            "prev"
          );

        request.onerror =
          () =>
            reject(
              request.error
            );

        request.onsuccess =
          event => {

            const cursor =
              event.target.result;

            // Done
            if (
              !cursor
            ) {

              resolve(
                results
              );

              return;
            }

            // Limit reached
            if (
              options.limit &&
              results.length >=
                options.limit
            ) {

              resolve(
                results
              );

              return;
            }

            results.push(
              cursor.value
            );

            cursor.continue();
          };
      }
    );
  }

  // =========================================================
  // RELAYS
  // =========================================================

  async relaysPut(record) {

    const store =
      this.#store(
        STORE_RELAYS,
        "readwrite"
      );

    await this.#request(
      store.put(record)
    );
  }

  async relaysGet(
    options = {}
  ) {

    const store =
      this.#store(
        STORE_RELAYS
      );

    // =====================================================
    // SINGLE LOOKUP
    // =====================================================

    if (
      options.relayUrl
    ) {

      const result =
        await this.#request(
          store.get(
            options.relayUrl
          )
        );

      return result
        ? [result]
        : [];
    }

    // Relay count should remain small,
    // so getAll() is acceptable here.

    return await this.#request(
      store.getAll()
    );
  }
}