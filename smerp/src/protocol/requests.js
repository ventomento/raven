// Requests to a relay as { method, target, body?, headers? }. target is the
// path and query relative to the relay URL: it is what gets signed, and the
// session appends it to relayUrl to send it.

export function getEnvelopes(cursor) {

    return { method: "GET", target: `/envelopes?cursor=${cursor}` };
}

export function postEnvelope(envelopeBytes) {

    return {
        method: "POST",
        target: "/envelopes",
        body: envelopeBytes,
        headers: { "content-type": "application/octet-stream" },
    };
}
