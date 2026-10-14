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
