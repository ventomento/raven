// SMERP wire constants (smerp/smerp_rfc.txt, smerp/src/auth/auth_rfc.txt).
// Request signature header names are in auth/request-signer.js (AuthHeaders).

import { EnvelopeLayout } from "../../../smep/src/index.js";

export const SmerpHeaders = Object.freeze({
    cursor: "x-smerp-cursor",
    relayPkh: "x-smerp-relay-pkh",
    unauthorized: "x-smerp-unauthorized",
    retryAfter: "retry-after",
});

export const Status = Object.freeze({
    OK: 200,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    TOO_MANY_REQUESTS: 429,
});

// Largest envelope, header included (smep_rfc section 4).
export const MAX_ENVELOPE_BYTES = EnvelopeLayout.MAX_SIZE;

// Largest sum of envelope lengths in one GET batch, framing not counted
// (smerp_rfc section 4).
export const MAX_BATCH_BYTES = 4 * 1024 * 1024;

// Smallest envelope: header plus iv and tag, empty ciphertext.
const MIN_ENVELOPE_BYTES = EnvelopeLayout.HEADER_SIZE + EnvelopeLayout.SIZES.MIN_PAYLOAD;

// Largest valid GET body: a full batch of the smallest envelopes, each
// with its 4-byte length. A client reads no more than this from a relay.
export const MAX_RESPONSE_BYTES =
    MAX_BATCH_BYTES + 4 * Math.floor(MAX_BATCH_BYTES / MIN_ENVELOPE_BYTES);
