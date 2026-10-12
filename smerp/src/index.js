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
    getEnvelopes,
    postEnvelope,
    encodeBatch,
    decodeBatch,
    parseCursor,
    retryAfterMs,
} from "./protocol/index.js";

// relays: sessions, the pool that runs them, rate limits
export { RelaySession, SessionOutcome } from "./relay/relay-session.js";
export { RelayPool, SessionState } from "./relay/relay-pool.js";
export { RelayRateLimits } from "./relay/rate-limits.js";

// local state: the only storage writers
export { RelayDirectory } from "./state/relay-directory.js";
export { MessageStore } from "./state/message-store.js";

// receiving and sending
export { EnvelopeOpener } from "./inbox/envelope-opener.js";
export { Ingestor, IngestOutcome } from "./inbox/ingestor.js";
export { Sender } from "./outbox/sender.js";
export { composeClient } from "./client/compose.js";

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
export { LightLog } from "./log/light-log.js";
