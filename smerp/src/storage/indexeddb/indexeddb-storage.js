import {
  StorageInterface,
  newestFirst,
} from "../storage-interface.js";

import {
  STORES,
  INDEXES,
} from "./constants.js";

import {
  openDatabase,
} from "./open-database.js";

export class IndexedDbStorage
  extends StorageInterface {

  constructor(key) {
    super();

    this.databaseName =
      `storage-${key}`;

    this.db = null;
  }

  async init() {

    if (this.db) {
      return;
    }

    this.db =
      await openDatabase(
        this.databaseName
      );
  }

  async close() {

    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
  }

  async envelopesGet(options = {}) {

    if (options.hash) {
      return this.#getEnvelopeByHash(
        options.hash
      );
    }

    if (options.publicKeyHex) {
      return this.#getEnvelopesByConversation(
        options
      );
    }

    const envelopes = await this.#getAll(
      STORES.ENVELOPES
    );

    return envelopes.sort(newestFirst);
  }

  async envelopesPut(record) {

    await this.#put(
      STORES.ENVELOPES,
      record
    );

    return record.hash;
  }

  async conversationsGet(
    options = {}
  ) {

    if (
      options.publicKeyHex
    ) {

      return this.#getByKey(
        STORES.CONVERSATIONS,
        options.publicKeyHex
      );
    }

    return this.#getAll(
      STORES.CONVERSATIONS
    );
  }

  async conversationsPut(
    record
  ) {

    await this.#put(
      STORES.CONVERSATIONS,
      record
    );

    return record.publicKeyHex;
  }

  async relaysGet(
    options = {}
  ) {

    if (
      options.relayUrl
    ) {

      return this.#getByKey(
        STORES.RELAYS,
        options.relayUrl
      );
    }

    return this.#getAll(
      STORES.RELAYS
    );
  }

  async relaysPut(record) {

    await this.#put(
      STORES.RELAYS,
      record
    );

    return record.relayUrl;
  }

  async relaysDelete({ relayUrl }) {

    const existing =
      await this.#getByKey(
        STORES.RELAYS,
        relayUrl
      );

    if (existing.length === 0) {
      return 0;
    }

    await this.#delete(
      STORES.RELAYS,
      relayUrl
    );

    return 1;
  }

  async #delete(
    storeName,
    key
  ) {

    return new Promise(
      (resolve, reject) => {

        const tx =
          this.db.transaction(
            storeName,
            "readwrite"
          );

        const request =
          tx.objectStore(
            storeName
          ).delete(key);

        request.onsuccess =
          () => resolve();

        request.onerror =
          () => reject(
            request.error
          );
      }
    );
  }

  async #put(
    storeName,
    record
  ) {

    return new Promise(
      (resolve, reject) => {

        const tx =
          this.db.transaction(
            storeName,
            "readwrite"
          );

        const store =
          tx.objectStore(
            storeName
          );

        const request =
          store.put(
            structuredClone(
              record
            )
          );

        request.onsuccess =
          () => resolve();

        request.onerror =
          () => reject(
            request.error
          );
      }
    );
  }

  async #getByKey(
    storeName,
    key
  ) {

    return new Promise(
      (resolve, reject) => {

        const tx =
          this.db.transaction(
            storeName,
            "readonly"
          );

        const store =
          tx.objectStore(
            storeName
          );

        const request =
          store.get(key);

        request.onsuccess =
          () => {

            const result =
              request.result;

            if (!result) {
              resolve([]);
              return;
            }

            resolve([
              structuredClone(
                result
              )
            ]);
          };

        request.onerror =
          () => reject(
            request.error
          );
      }
    );
  }

  async #getEnvelopeByHash(
    hash
  ) {

    return this.#getByKey(
      STORES.ENVELOPES,
      hash
    );
  }

  async #getAll(
    storeName
  ) {

    return new Promise(
      (resolve, reject) => {

        const tx =
          this.db.transaction(
            storeName,
            "readonly"
          );

        const store =
          tx.objectStore(
            storeName
          );

        const request =
          store.getAll();

        request.onsuccess =
          () => {

            resolve(
              structuredClone(
                request.result
              )
            );
          };

        request.onerror =
          () => reject(
            request.error
          );
      }
    );
  }

  async #getEnvelopesByConversation(
    {
      publicKeyHex,
      beforeSentAt,
      beforeReceivedAt,
      limit,
    }
  ) {

    return new Promise(
      (resolve, reject) => {

        const tx =
          this.db.transaction(
            STORES.ENVELOPES,
            "readonly"
          );

        const store =
          tx.objectStore(
            STORES.ENVELOPES
          );

        const index =
          store.index(
            INDEXES.CONVERSATION_SENT_AT
          );

        const results = [];

        const upperKey =
          beforeSentAt === undefined
            ? [publicKeyHex, Number.MAX_SAFE_INTEGER]
            : beforeReceivedAt === undefined
              ? [publicKeyHex, beforeSentAt]
              : [publicKeyHex, beforeSentAt, beforeReceivedAt];

        const range =
          IDBKeyRange.bound(
            [
              publicKeyHex,
              -Infinity,
            ],
            upperKey,
            false,
            true
          );

        const request =
          index.openCursor(
            range,
            "prev"
          );

        request.onsuccess =
          (event) => {

            const cursor =
              event.target.result;

            if (!cursor) {

              resolve(
                structuredClone(
                  results
                )
              );

              return;
            }

            results.push(
              cursor.value
            );

            if (
              limit &&
              results.length >=
                limit
            ) {

              resolve(
                structuredClone(
                  results
                )
              );

              return;
            }

            cursor.continue();
          };

        request.onerror =
          () => reject(
            request.error
          );
      }
    );
  }
  

}