import {
  DB_VERSION,
  STORES,
  INDEXES,
} from "./constants.js";

export function openDatabase(databaseName) {
  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        databaseName,
        DB_VERSION
      );

    request.onerror = () => {
      reject(request.error);
    };

    request.onupgradeneeded = (event) => {

      const db = request.result;

      // v1 held times in seconds under other names. There is no data
      // worth keeping, so start over rather than migrate.
      if (event.oldVersion < 2) {
        for (const name of [...db.objectStoreNames]) {
          db.deleteObjectStore(name);
        }
      }

      //
      // envelopes
      //

      if (
        !db.objectStoreNames.contains(
          STORES.ENVELOPES
        )
      ) {

        const store =
          db.createObjectStore(
            STORES.ENVELOPES,
            {
              keyPath: "uuid",
            }
          );

        // receivedAt breaks ties between envelopes sent in the same second.
        store.createIndex(
          INDEXES.CONVERSATION_SENT_AT,
          [
            "publicKeyHex",
            "sentAt",
            "receivedAt",
          ],
          {
            unique: false,
          }
        );
      }

      //
      // conversations
      //

      if (
        !db.objectStoreNames.contains(
          STORES.CONVERSATIONS
        )
      ) {

        db.createObjectStore(
          STORES.CONVERSATIONS,
          {
            keyPath: "publicKeyHex",
          }
        );
      }

      //
      // relays
      //

      if (
        !db.objectStoreNames.contains(
          STORES.RELAYS
        )
      ) {

        db.createObjectStore(
          STORES.RELAYS,
          {
            keyPath: "relayUrl",
          }
        );
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}