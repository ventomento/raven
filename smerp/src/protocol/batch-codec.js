// GET /envelopes batch body (smerp_rfc section 4):
//
//   body  = frame *frame
//   frame = length (uint32, big-endian) || envelope

const LENGTH_SIZE = 4;

/**
 * envelopes: array of ArrayBuffer | Uint8Array. Returns the body as a
 * Uint8Array. Packing to MAX_BATCH_BYTES is the caller's job.
 */
export function encodeBatch(envelopes) {

    const parts = envelopes.map(toBytes);

    const size = parts.reduce((sum, part) => sum + LENGTH_SIZE + part.byteLength, 0);

    const body = new Uint8Array(size);
    const view = new DataView(body.buffer);

    let offset = 0;

    for (const part of parts) {
        view.setUint32(offset, part.byteLength, false);
        body.set(part, offset + LENGTH_SIZE);
        offset += LENGTH_SIZE + part.byteLength;
    }

    return body;
}

/**
 * body: ArrayBuffer | Uint8Array. Returns { frames, error }:
 *   frames  each envelope as its own ArrayBuffer (what readEnvelope takes),
 *           up to the first framing error
 *   error   null, or why the framing is broken
 *
 * Only the framing is checked here. Whether a frame holds a valid envelope
 * is for whoever opens it.
 */
export function decodeBatch(body) {

    const bytes = toBytes(body);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const frames = [];

    let offset = 0;

    while (offset < bytes.byteLength) {

        if (offset + LENGTH_SIZE > bytes.byteLength) {
            return { frames, error: "batch ends inside a frame length" };
        }

        const length = view.getUint32(offset, false);
        const start = offset + LENGTH_SIZE;

        if (start + length > bytes.byteLength) {
            return { frames, error: "batch frame runs past the end of the body" };
        }

        frames.push(
            bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + length)
        );

        offset = start + length;
    }

    if (frames.length === 0) {
        return { frames, error: "batch holds no envelope" };
    }

    return { frames, error: null };
}

function toBytes(value) {

    if (value instanceof Uint8Array) {
        return value;
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }

    throw new TypeError("expected ArrayBuffer or Uint8Array");
}
