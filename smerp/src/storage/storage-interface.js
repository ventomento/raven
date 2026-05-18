// src/storage/storage-interface.js

// All "Get" operations must return a list of js objects (maps/dicts).
// If no records return empty list.

// envelopes must be keyed by uuid.
// conversations must be keyed by publicKeyHex.
// relays must be keyed by relayUrl.

// put operations must return the key of the record it inserted.

// with keyed meaning unique field and record retrievable by key.

export class StorageInterface {

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
  
}

/* Record Models in storage 

# relay record:
relayUrl (primaryKey)
disabled;
cursor
lastSuccessAt
lastFailureAt
failureCount

# envelope record:
pubKeyHex (main get query key together with timestamp)
senderPublicKeyHex (required)
recipientPublicKeyHex (required)
contentType (required)
plaintext (required)
timestamp (required)
uuid (primary key)
relayUrl,
receivedAt,

#conversation record:
publicKeyHex (primaryKey)
unreadCount
lastMessageAt

*/