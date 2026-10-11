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
export { RequestBuilder } from "./request/request-builder.js";
export { RelayRequester } from "./request/relay-requester.js";

// sync and ingest
export { SyncEngine } from "./sync/sync-engine.js";
export { EnvelopeStream } from "./sync/envelope-stream.js";
export { ConcurrencyLimiter } from "./sync/concurrency-limiter.js";
export { RateLimiter, RelayRateLimits } from "./sync/rate-limiter.js";
export { Ingestor, IngestOutcome } from "./ingest/ingestor.js";

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
export { LightLog } from "./log/light-log.js";
