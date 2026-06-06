import {
  DB_VERSION,
  STORES,
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

        store.createIndex(
          "conversationTimestamp",
          [
            "publicKeyHex",
            "timestamp",
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