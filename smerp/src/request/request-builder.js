// Requests to a relay as { method, url, target, body?, headers? }.
// target is the path and query relative to relayUrl; it is what gets
// signed, so it is built once together with the url.

export class RequestBuilder {

    static envelopesGet(relay) {

        const target = `/envelopes?cursor=${relay.cursor ?? 0}`;

        return { method: "GET", url: `${relay.relayUrl}${target}`, target };
    }

    static envelopesPost(relay, envelopeBytes) {

        const target = "/envelopes";

        return {
            method: "POST",
            url: `${relay.relayUrl}${target}`,
            target,
            body: envelopeBytes,
            headers: { "content-type": "application/octet-stream" },
        };
    }
}
