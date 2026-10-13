// smerp: the reference client and the building blocks it is made of.
// Use the building blocks to assemble your own client.

// reference client
export { SmerpClient, ClientStatus } from "./client/smerp-client.js";
export { SmerpError, NotStartedError, DispatchError } from "./client/errors.js";

// events
export { EventBus, EventTypes } from "./event/event-bus.js";

// storage
export { StorageInterface } from "./storage/storage-interface.js";
export { StorageMemory } from "./storage/storage-memory.js";
export { IndexedDbStorage } from "./storage/indexeddb/indexeddb-storage.js";

// transport
export { TransportInterface } from "./transport/transport-interface.js";
export { TransportDefault } from "./transport/transport-default.js";

// wire format (pure, shared with the mock relay)
export {
    SmerpHeaders,
    Status,
    MAX_ENVELOPE_BYTES,
    MAX_BATCH_BYTES,
    MAX_RESPONSE_BYTES,
    encodeBatch,
    decodeBatch,
    parseCursor,
} from "./protocol/index.js";

// sync: the scheduler, the relay sessions it runs, and ingestion
export { Scheduler } from "./sync/scheduler.js";
export { RelaySession } from "./session/relay-session.js";
export { RequestBuilder } from "./session/request-builder.js";
export { Ingestor, MAX_CONVERSATION_NAME } from "./ingest/ingestor.js";

// generic building blocks
export { ConcurrencyLimiter } from "./lib/concurrency-limiter.js";
export { TokenBucket } from "./lib/token-bucket.js";
export { RealClock } from "./lib/clock.js";

// relay auth
export {
    AuthHeaders,
    RequestSigner,
    RequestVerifier,
    canonicalRequest,
    bodyHashHex,
    hmacKeyFor,
    normalizePkh,
} from "./auth/request-signer.js";

// logging
export { Logger } from "./log/logger.js";
