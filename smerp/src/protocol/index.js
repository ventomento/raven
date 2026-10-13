// Pure SMERP wire format, shared by the client and the mock relay.

export { SmerpHeaders, Status, MAX_ENVELOPE_BYTES, MAX_BATCH_BYTES } from "./constants.js";
export { encodeBatch, decodeBatch } from "./batch-codec.js";
export { parseCursor } from "./cursor.js";
