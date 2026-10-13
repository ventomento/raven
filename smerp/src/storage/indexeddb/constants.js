// 2: envelope timestamp (seconds) renamed sentAt (ms); index on
//    [publicKeyHex, sentAt, receivedAt]. No migration: v1 stores are dropped.
// 3: envelopes keyed by hash (sha256 of the bytes) instead of uuid. No
//    migration: older stores are dropped.
export const DB_VERSION = 3;

export const STORES = {
  ENVELOPES: "envelopes",
  CONVERSATIONS: "conversations",
  RELAYS: "relays",
};
export const INDEXES = {
  CONVERSATION_SENT_AT: "conversationSentAt",
};
