import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { TransportDefault } from "../transport/transport-default.js";
import { RequestBuilder } from "../request/request-builder.js";
import { Authenticator} from "../auth/authenticator.js";
import { RealClock, retryAfterMs } from "./rate-limiter.js";

const SMERP_HEADERS = Object.freeze({
    cursor: "x-smerp-cursor",
    signature: "x-smerp-signature",
    timestamp: "x-smerp-timestamp",
    unauthorized: "x-smerp-unauthorized",
});

const STATUS = Object.freeze({
    OK: 200,
    NO_CONTENT: 204,
    UNAUTHORIZED: 401,
    TOO_MANY_REQUESTS: 429,
});

/**
 * Pages GET /envelopes for one relay, one envelope per request.
 *
 * next() fetches from relay.cursor and reports what came back. It does
 * not advance relay.cursor: the caller does that once the envelope is
 * ingested, so a failed ingest is fetched again on the next sync.
 *
 * Results:
 *   { type: "envelope", bytes, cursor }   cursor: position after it
 *   { type: "invalid-body", cursor }      200 without a binary body
 *   { type: "exhausted" }                 204, nothing newer
 *   { type: "throttled", retryAfterMs }   429
 *   { type: "failure", error }            anything else
 *
 * Relay health (failureCount, lastSuccessAt, lastFailureAt) is updated
 * on relay as a side effect. A 429 counts as neither.
 */
export class EnvelopeStream {

    constructor({
        identity,
        relay,
        transporter = TransportDefault,
        logger,
        clock = RealClock,
        authenticator = new Authenticator({ identity, relay, clock }),
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.relay = relay;
        this.relay.cursor ??= 0;

        this.transporter = transporter;
        this.logger = logger;
        this.clock = clock;
        this.authenticator = authenticator;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    async next() {

        let response;

        try {
            response = await this.envelopesGet();
        }
        catch (error) {
            this.relayFailure();
            return { type: "failure", error };
        }

        return this.processResponse(response);
    }

    // ------------------------------------------------------------------
    // Transport
    // ------------------------------------------------------------------

    async envelopesGet() {

        return this.transporter.transport({
            url: RequestBuilder.urlEnvelopesGet(
                this.relay,
                this.identity.publicKeyHex
            ),
            options: {
                headers: await this.authenticator.headers(),
            },
            logger: this.logger,
        });
    }

    // ------------------------------------------------------------------
    // Protocol
    // ------------------------------------------------------------------

    processResponse(response) {

        switch (response.status) {

            case STATUS.OK:
                return this.on200(response);

            case STATUS.NO_CONTENT:
                return this.on204(response);

            case STATUS.UNAUTHORIZED:
                return this.on401(response);

            case STATUS.TOO_MANY_REQUESTS:
                return this.on429(response);

            default:
                return this.onUnsupported(response);
        }
    }

    on200(response) {

        let cursor;

        try {
            cursor = this.parseCursor(response.headers);
        }
        catch (error) {
            this.relayFailure();
            this.logger?.warn?.(`Invalid cursor received: ${error.message}`);
            return { type: "failure", error };
        }

        // The cursor is valid, so the relay can be moved past whatever this
        // is, but serving it is the relay's fault.
        if (!(response.body instanceof ArrayBuffer)) {
            this.relayFailure();
            return { type: "invalid-body", cursor };
        }

        this.relaySuccess();

        return { type: "envelope", bytes: response.body, cursor };
    }

    on204() {

        this.relaySuccess();

        return { type: "exhausted" };
    }

    on401(response) {

        if (SMERP_HEADERS.unauthorized in response.headers) {
            this.logger?.warn?.("smerp protocol unauthorized");
        }

        this.relayFailure();

        return {
            type: "failure",
            error: new Error(`Relay unauthorized: ${this.relay.relayUrl}`),
        };
    }

    on429(response) {

        return {
            type: "throttled",
            retryAfterMs: retryAfterMs(response.headers, this.clock.now()),
        };
    }

    onUnsupported(response) {

        this.relayFailure();

        this.logger?.warn?.(
            `Unsupported response status: ${response.status}`
        );

        return {
            type: "failure",
            error: new Error(`Unsupported response status: ${response.status}`),
        };
    }

    // ------------------------------------------------------------------
    // Cursor
    // ------------------------------------------------------------------

    parseCursor(headers) {

        const nextCursor = Number(headers[SMERP_HEADERS.cursor]);

        if (!Number.isSafeInteger(nextCursor)) {
            throw new Error("invalid cursor");
        }

        if (nextCursor <= this.relay.cursor) {
            throw new Error("cursor regression");
        }

        return nextCursor;
    }

    // ------------------------------------------------------------------
    // Relay health
    // ------------------------------------------------------------------

    relaySuccess() {

        this.relay.lastSuccessAt = this.clock.now();
        this.relay.failureCount = 0;
    }

    relayFailure() {

        this.relay.failureCount = (this.relay.failureCount ?? 0) + 1;
        this.relay.lastFailureAt = this.clock.now();
    }
}
