/**
 * The cursor from a 200's x-smerp-cursor header. Throws unless it is an
 * integer greater than the requested one (smerp_rfc section 4).
 */
export function parseCursor(value, requested) {

    // Number("") is 0, so an empty header is caught by the regression check.
    const cursor = Number(value);

    if (value === undefined || !Number.isSafeInteger(cursor)) {
        throw new Error("invalid cursor");
    }

    if (cursor <= requested) {
        throw new Error("cursor regression");
    }

    return cursor;
}
