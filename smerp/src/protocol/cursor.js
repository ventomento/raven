export function parseCursor(value, requested) {
    const cursor = Number(value);

    if (value === undefined || !Number.isSafeInteger(cursor)) {
        throw new Error("invalid cursor");
    }

    if (cursor <= requested) {
        throw new Error("cursor regression");
    }

    return cursor;
}

const EPOCH = /^[A-Za-z0-9_-]{1,64}$/;

// The relay's cursor space (smerp_rfc section 4): an opaque name that changes
// whenever the relay's cursors start over. null when absent or malformed.
export function parseEpoch(value) {
    return typeof value === "string" && EPOCH.test(value) ? value : null;
}
