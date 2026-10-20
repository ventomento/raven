import { SmerpHeaders } from "../protocol/index.js";
import { AuthHeaders } from "../auth/request-signer.js";

// Request headers a browser client sends (auth_rfc section 9).
const ALLOWED_REQUEST_HEADERS = [
    "content-type",
    AuthHeaders.pkh,
    AuthHeaders.timestamp,
    AuthHeaders.signature,
    AuthHeaders.token,
];

// Response headers a browser client must be able to read (smerp_rfc
// section 4, auth_rfc section 9).
const EXPOSED_RESPONSE_HEADERS = [
    SmerpHeaders.cursor,
    SmerpHeaders.unauthorized,
    SmerpHeaders.relayPkh,
];

export function setCorsHeaders(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_REQUEST_HEADERS.join(", "));
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_RESPONSE_HEADERS.join(", "));
}

export function send(res, status, { headers = {}, body } = {}) {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
    }
    res.end(body);
}

// Reads the request body into an ArrayBuffer. Resolves null as soon as the
// body grows past maxBytes, whatever Content-Length said (or if it said
// nothing); the rest of the body is drained and discarded.
export function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        const onData = (chunk) => {
            size += chunk.byteLength;

            if (size > maxBytes) {
                req.off("data", onData);
                req.off("end", onEnd);
                req.resume();
                resolve(null);
                return;
            }

            chunks.push(chunk);
        };

        const onEnd = () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        };

        req.on("data", onData);
        req.on("end", onEnd);
        req.on("error", reject);
    });
}

// The cursor query parameter: absent means 0, otherwise a non-negative
// decimal integer. Returns null for anything else.
export function parseCursorParam(value) {
    if (value === null) {
        return 0;
    }

    if (!/^\d+$/.test(value)) {
        return null;
    }

    const cursor = Number(value);

    return Number.isSafeInteger(cursor) ? cursor : null;
}
