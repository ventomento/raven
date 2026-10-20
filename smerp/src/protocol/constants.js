import { EnvelopeLayout } from "../../../smep/src/index.js";

export const SmerpHeaders = Object.freeze({
    cursor: "x-smerp-cursor",
    relayPkh: "x-smerp-relay-pkh",
    unauthorized: "x-smerp-unauthorized",
    retryAfter: "retry-after",
    cacheControl: "cache-control",
});

export const Status = Object.freeze({
    OK: 200,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    TOO_MANY_REQUESTS: 429,
});

export const MAX_ENVELOPE_BYTES = EnvelopeLayout.MAX_SIZE;

export const MAX_BATCH_BYTES = 4 * 1024 * 1024;

const MIN_ENVELOPE_BYTES = EnvelopeLayout.HEADER_SIZE + EnvelopeLayout.SIZES.MIN_PAYLOAD;

export const MAX_RESPONSE_BYTES =
    MAX_BATCH_BYTES + 4 * Math.floor(MAX_BATCH_BYTES / MIN_ENVELOPE_BYTES);
