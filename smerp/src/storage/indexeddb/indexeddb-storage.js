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

  //
  // envelopes
  //

  async envelopesGet(options = {}) {

    if (options.uuid) {
      return this.#getEnvelopeByUuid(
        options.uuid
      );
    }

    if (options.publicKeyHex) {
      return this.#getEnvelopesByConversation(
        options
      );
    }

    // getAll returns primary key (uuid) order; the contract is newest first.
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

    return record.uuid;
  }

  //
  // conversations
  //

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

  //
  // relays
  //

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

  //
  // helpers
  //

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

  async #getEnvelopeByUuid(
    uuid
  ) {

    return this.#getByKey(
      STORES.ENVELOPES,
      uuid
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
 /* 
  async #getEnvelopesByConversation(
  {
    publicKeyHex,
    beforeTimestamp,
    limit,
  }
) {

  console.log(
    "=================================================="
  );

  console.log(
    "#getEnvelopesByConversation()"
  );

  console.log(
    "publicKeyHex:",
    publicKeyHex
  );

  console.log(
    "publicKeyHex JSON:",
    JSON.stringify(
      publicKeyHex
    )
  );

  console.log(
    "beforeTimestamp:",
    beforeTimestamp
  );

  console.log(
    "limit:",
    limit
  );

  return new Promise(
    (resolve, reject) => {

      try {

        const tx =
          this.db.transaction(
            STORES.ENVELOPES,
            "readonly"
          );

        console.log(
          "transaction created"
        );

        const store =
          tx.objectStore(
            STORES.ENVELOPES
          );
        
        const storeDump =
  store.openCursor();

storeDump.onsuccess =
  e => {

    const cursor =
      e.target.result;

    if (!cursor) {

      console.log(
        "END STORE DUMP"
      );

      return;
    }

    console.log(
      "STORE RECORD:",
      cursor.value
    );

    cursor.continue();
  };

        console.log(
          "store:",
          store.name
        );

        console.log(
          "available indexes:",
          [
            ...store.indexNames
          ]
        );

        const index =
          store.index(
            "conversationTimestamp"
          );

        console.log(
          "index acquired"
        );

        //
        // Dump entire index
        //

        console.log(
          "----- FULL INDEX DUMP -----"
        );

        const dumpRequest =
          index.openCursor();

        dumpRequest.onsuccess =
          (event) => {

            const cursor =
              event.target.result;

            if (!cursor) {

              console.log(
                "----- END INDEX DUMP -----"
              );

              return;
            }

            console.log(
              "INDEX KEY:",
              cursor.key
            );

            console.log(
              "INDEX VALUE:",
              cursor.value
            );

            cursor.continue();
          };

        dumpRequest.onerror =
          () => {

            console.error(
              "INDEX DUMP ERROR",
              dumpRequest.error
            );
          };

        const results = [];

        const upper =
          beforeTimestamp ??
          Number.MAX_SAFE_INTEGER;

        console.log(
          "upper:",
          upper
        );

        const lowerBound = [
          publicKeyHex,
          -Infinity,
        ];

        const upperBound = [
          publicKeyHex,
          upper,
        ];

        console.log(
          "lowerBound:",
          lowerBound
        );

        console.log(
          "upperBound:",
          upperBound
        );

        const range =
          IDBKeyRange.bound(
            lowerBound,
            upperBound,
            false,
            true
          );

        console.log(
          "range created"
        );

        const request =
          index.openCursor(
            range,
            "prev"
          );

        console.log(
          "cursor opened"
        );

        request.onsuccess =
          (event) => {

            const cursor =
              event.target.result;

            if (!cursor) {

              console.log(
                "NO MORE CURSORS"
              );

              console.log(
                "FINAL RESULTS:",
                results
              );

              resolve(
                structuredClone(
                  results
                )
              );

              return;
            }

            console.log(
              "MATCHED KEY:",
              cursor.key
            );

            console.log(
              "MATCHED VALUE:",
              cursor.value
            );

            results.push(
              cursor.value
            );

            if (
              limit &&
              results.length >=
                limit
            ) {

              console.log(
                "LIMIT REACHED"
              );

              console.log(
                "FINAL RESULTS:",
                results
              );

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
          () => {

            console.error(
              "QUERY ERROR:",
              request.error
            );

            reject(
              request.error
            );
          };

        tx.onerror =
          () => {

            console.error(
              "TRANSACTION ERROR:",
              tx.error
            );

            reject(
              tx.error
            );
          };

      } catch (err) {

        console.error(
          "OUTER ERROR:",
          err
        );

        reject(err);
      }
    }
  );
}
*/

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

        // Keys are [publicKeyHex, sentAt, receivedAt] and the upper bound
        // is open. [publicKeyHex, beforeSentAt] sorts below every key with
        // that sentAt (a shorter array is smaller), so they are excluded;
        // with beforeReceivedAt only the pair itself and above are.
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