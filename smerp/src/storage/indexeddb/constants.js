// 2: envelope timestamp (seconds) renamed sentAt (ms); index on
//    [publicKeyHex, sentAt, receivedAt]. No migration: v1 stores are dropped.
export const DB_VERSION = 2;

export const STORES = {
  ENVELOPES: "envelopes",
  CONVERSATIONS: "conversations",
  RELAYS: "relays",
};
export const INDEXES = {
  CONVERSATION_SENT_AT: "conversationSentAt",
};
