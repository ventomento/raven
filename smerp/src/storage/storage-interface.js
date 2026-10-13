// src/storage/storage-interface.js

/**
 * StorageInterface
 *
 * Abstract storage contract for application persistence.
 *
 * The purpose of this interface is to allow the application to operate
 * independently of the underlying storage implementation.
 *
 * Possible implementations include:
 *
 * - IndexedDB (browser persistence)
 * - In-memory storage (testing)
 * - Node.js storage implementations
 * - Future platform-specific storage backends
 *
 * Any implementation must follow the behavior documented below.
 *
 * ------------------------------------------------------------------
 * GENERAL RULES
 * ------------------------------------------------------------------
 *
 * Get Operations
 * --------------
 *
 * All get operations return an array of plain JavaScript objects.
 *
 * If no records match the query:
 *
 *   []
 *
 * is returned.
 *
 * Returned records must be detached copies of the stored data.
 * Modifying a returned object must never modify persisted storage.
 *
 * Example:
 *
 *   const [record] = await storage.conversationsGet(...);
 *   record.unreadCount = 999;
 *
 * must not affect storage.
 *
 * Changes are only persisted through the corresponding Put operation.
 *
 *
 * Put Operations
 * --------------
 *
 * Put operations behave like Map.set().
 *
 * If no record exists for the record's primary key:
 *
 *   insert
 *
 * If a record already exists for the primary key:
 *
 *   replace the existing record entirely
 *
 * Implementations must not merge fields.
 *
 * Put operations return the primary key of the stored record.
 *
 *
 * Delete Operations
 * -----------------
 *
 * Delete operations take the same options as the corresponding Get
 * operation, restricted to the primary key, and remove the matching
 * record.
 *
 * Deleting a record that does not exist is not an error.
 *
 * Delete operations return the number of records removed.
 *
 *
 * Query Semantics
 * ---------------
 *
 * Empty query options return all records.
 *
 * Additional query options further restrict the result set.
 *
 * Example:
 *
 *   conversationsGet({})
 *
 * returns all conversations.
 *
 *   conversationsGet({
 *     publicKeyHex
 *   })
 *
 * returns at most one conversation.
 *
 *
 * Lifecycle
 * ---------
 *
 * init()
 *   Prepare the storage backend for use.
 *
 * close()
 *   Release any resources held by the storage backend.
 *
 * Implementations that do not require initialization or cleanup
 * may implement these methods as no-ops.
 */

export class StorageInterface {

  // =========================================================
  // LIFECYCLE
  // =========================================================

  async init() {
    throw new Error(
      "init() not implemented"
    );
  }

  async close() {
    throw new Error(
      "close() not implemented"
    );
  }

  // =========================================================
  // ENVELOPES
  // =========================================================

  /**
   * Query envelopes.
   *
   * Primary Key
   * -----------
   *
   * hash
   *
   * Supported Query Options
   * -----------------------
   *
   * {}
   *
   *   Return all envelopes.
   *
   * {
   *   hash
   * }
   *
   *   Return the envelope matching the given hash.
   *
   * {
   *   publicKeyHex
   * }
   *
   *   Return all envelopes belonging to the conversation.
   *
   * {
   *   publicKeyHex,
   *   beforeSentAt,
   *   beforeReceivedAt?,
   *   limit
   * }
   *
   *   Return envelopes belonging to the conversation
   *   that sort after (older than) the given position.
   *
   * Pagination
   * ----------
   *
   * The position is exclusive.
   *
   * With beforeSentAt only, returns records where:
   *
   *   sentAt < beforeSentAt
   *
   * With beforeReceivedAt as well, the position is the pair, so
   * records sharing the boundary sentAt are not skipped:
   *
   *   sentAt < beforeSentAt ||
   *   (sentAt === beforeSentAt && receivedAt < beforeReceivedAt)
   *
   * To page, pass the sentAt and receivedAt of the last record of
   * the previous page. sentAt comes from a whole-second wire
   * timestamp, so ties are common.
   *
   *
   * Ordering
   * --------
   *
   * Envelope queries that return multiple records must be sorted
   * newest first: by sentAt descending, then receivedAt descending
   * (see newestFirst).
   *
   * Example (sentAt, receivedAt):
   *
   *   105000, 105400
   *   105000, 105390
   *   104000, 104200
   *   ...
   *
   * limit restricts the maximum number of records returned.
   */
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

  /**
   * Query conversations.
   *
   * Primary Key
   * -----------
   *
   * publicKeyHex
   *
   * Supported Query Options
   * -----------------------
   *
   * {}
   *
   *   Return all conversations.
   *
   * {
   *   publicKeyHex
   * }
   *
   *   Return the conversation matching the given key.
   *
   * No pagination is supported.
   *
   * Ordering is implementation-defined.
   */
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
  // RELAYS
  // =========================================================

  /**
   * Query relay records.
   *
   * Primary Key
   * -----------
   *
   * relayUrl
   *
   * Supported Query Options
   * -----------------------
   *
   * {}
   *
   *   Return all relay records.
   *
   * {
   *   relayUrl
   * }
   *
   *   Return the relay matching the given URL.
   *
   * No pagination is supported.
   *
   * Ordering is implementation-defined.
   */
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

  /**
   * Delete a relay record.
   *
   * Supported Options
   * -----------------
   *
   * {
   *   relayUrl
   * }
   */
  async relaysDelete(options) {
    throw new Error(
      "relaysDelete() not implemented"
    );
  }

}

/*
====================================================================
RECORD MODELS
====================================================================

All times are milliseconds since epoch and named ...At.

Relay Record
------------

relayUrl          (primary key)
relayType
relayPkh          (optional; learned from x-smerp-relay-pkh responses)
relayToken        (optional; set by the user, sent as a bearer token)
disabled          (set by the user only; sync skips the relay)
cursor            (sync-owned)
lastSuccessAt     (sync-owned)
lastFailureAt     (sync-owned)
failureCount      (sync-owned; consecutive failures, drives backoff)
lastFailureReason (sync-owned; why the last request failed, null after
                   a success. May quote the relay: untrusted text)


Envelope Record
---------------

hash                     (primary key; hex sha256 of the envelope bytes)

publicKeyHex             (conversation identifier)

senderPublicKeyHex       (required)
recipientPublicKeyHex    (required)

contentType              (required)
plaintext                (required)

sentAt                   (required; sender's clock, whole seconds)
receivedAt               (required; strictly increasing per client)

relayUrl


Conversation Record
-------------------

publicKeyHex             (primary key)

unreadCount
lastMessageAt

*/

/**
 * Implementations should provide efficient primary-key lookups for:
 *
 * envelopes.hash
 * conversations.publicKeyHex
 * relays.relayUrl
 *
 * Implementations should also provide efficient retrieval of
 * conversation envelopes by:
 *
 * publicKeyHex + sentAt + receivedAt
 */
/**
 * The envelope order every implementation returns: sentAt descending,
 * then receivedAt descending. receivedAt breaks ties between envelopes
 * sent in the same second.
 */
export function newestFirst(a, b) {
  return (b.sentAt - a.sentAt) || (b.receivedAt - a.receivedAt);
}

/**
 * True if envelope sorts after (is older than) the pagination position
 * { beforeSentAt, beforeReceivedAt? }. See envelopesGet.
 */
export function isBefore(envelope, { beforeSentAt, beforeReceivedAt }) {

  if (envelope.sentAt !== beforeSentAt || beforeReceivedAt === undefined) {
    return envelope.sentAt < beforeSentAt;
  }

  return envelope.receivedAt < beforeReceivedAt;
}
