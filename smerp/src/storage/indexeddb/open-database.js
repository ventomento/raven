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

    request.onupgradeneeded = () => {

      const db = request.result;

      if (
        !db.objectStoreNames.contains(
          STORES.ENVELOPES
        )
      ) {

        const store =
          db.createObjectStore(
            STORES.ENVELOPES,
            {
              keyPath: "hash",
            }
          );

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

      const db = request.result;

      // Another tab deleting or upgrading the database waits until every
      // connection closes; close ours instead of holding it up.
      db.onversionchange = () => {
        db.close();
      };

      resolve(db);
    };
  });
}