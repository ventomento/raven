/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export { SmerpClient, ClientStatus } from "./client/smerp-client.js";
export { SmerpError, NotStartedError, DispatchError, RelayThrottledError } from "./client/errors.js";

export { EventTypes } from "./event/event-bus.js";

export { StorageInterface } from "./storage/storage-interface.js";
export { StorageMemory } from "./storage/storage-memory.js";
export { IndexedDbStorage } from "./storage/indexeddb/indexeddb-storage.js";

export { TransportInterface } from "./transport/transport-interface.js";
export { TransportDefault } from "./transport/transport-default.js";

export {
    SmerpHeaders,
    Status,
    MAX_ENVELOPE_BYTES,
    MAX_BATCH_BYTES,
    MAX_RESPONSE_BYTES,
    encodeBatch,
    decodeBatch,
    parseCursor,
    parseRetryAfter,
} from "./protocol/index.js";

export { Scheduler } from "./sync/scheduler.js";
export { RelaySession } from "./session/relay-session.js";
export { RequestBuilder } from "./session/request-builder.js";
export { Ingestor, MAX_CONVERSATION_NAME } from "./ingest/ingestor.js";
export { NtfyNotifier } from "./notify/ntfy-notifier.js";

export { RequestVerifier } from "./auth/request-signer.js";

export { Logger } from "./log/logger.js";
