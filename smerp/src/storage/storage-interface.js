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
   * uuid
   *
   * Supported Query Options
   * -----------------------
   *
   * {}
   *
   *   Return all envelopes.
   *
   * {
   *   uuid
   * }
   *
   *   Return the envelope matching the given uuid.
   *
   * {
   *   publicKeyHex
   * }
   *
   *   Return all envelopes belonging to the conversation.
   *
   * {
   *   publicKeyHex,
   *   beforeTimestamp,
   *   limit
   * }
   *
   *   Return envelopes belonging to the conversation
   *   whose timestamp is strictly less than
   *   beforeTimestamp.
   *
   * Pagination
   * ----------
   *
   * beforeTimestamp is exclusive.
   *
   * Example:
   *
   *   beforeTimestamp = 100
   *
   * returns records where:
   *
   *   timestamp < 100
   *
   * not:
   *
   *   timestamp <= 100
   *
   *
   * Ordering
   * --------
   *
   * Envelope queries that return multiple records must be sorted
   * by timestamp descending (newest first).
   *
   * Example:
   *
   *   105
   *   104
   *   103
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

}

/*
====================================================================
RECORD MODELS
====================================================================

Relay Record
------------

relayUrl          (primary key)
relayType
disabled
cursor
lastSuccessAt
lastFailureAt
failureCount


Envelope Record
---------------

uuid                     (primary key)

publicKeyHex             (conversation identifier)

senderPublicKeyHex       (required)
recipientPublicKeyHex    (required)

contentType              (required)
plaintext                (required)

timestamp                (required)

relayUrl
receivedAt


Conversation Record
-------------------

publicKeyHex             (primary key)

unreadCount
lastMessageAt

*/

/**
 * Implementations should provide efficient primary-key lookups for:
 *
 * envelopes.uuid
 * conversations.publicKeyHex
 * relays.relayUrl
 *
 * Implementations should also provide efficient retrieval of
 * conversation envelopes by:
 *
 * publicKeyHex + timestamp
 */