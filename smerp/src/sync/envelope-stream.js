import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { TransportDefault } from "../transport/transport-default.js";
import { RequestBuilder } from "../request/request-builder.js";
import { Authenticator} from "../auth/authenticator.js";

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
});

export class EnvelopeStream {

    constructor({
        identity,
        relay,
        transporter = new TransportDefault(),
        logger,
        clock = {
            now: () => Date.now(),
        },
    }) {

        insist(identity, PrivateIdentity);

        this.identity = identity;
        this.relay = relay;
        this.relay.cursor ??= 0;

        this.transporter = transporter;
        this.logger = logger;
        this.clock = clock;

        this.authenticator = new Authenticator({
            identity,
            relay,
        });
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    async next() {

        let result = this.processResponse(
            await this.envelopesGet()
        );

        return result?.type === "envelope"
            ? result.envelope
            : null;
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

            default:
                return this.onUnsupported(response);
        }
    }

    on200(response) {

        try {

            this.updateCursor(response.headers);

            this.relaySuccess();

            return {
                type: "envelope",
                envelope: response.body,
            };

        } catch (error) {

            this.relayFailure();

            this.logger?.warn?.(
                `Invalid cursor received: ${error.message}`
            );

            return {
                type: "protocol-error",
            };
        }
    }

    on204() {

        this.relaySuccess();

        return {
            type: "exhausted",
        };
    }

    on401(response) {

        const smerpUnauthorized = response.headers.has(SMERP_HEADERS.unauthorized);
        
        if (smerpUnauthorized) {
            
            this.logger.warn("smerp protocol unauthorized");

        }

        this.relayFailure();
        
        return {
            type: "unauthorized",
        };
    }

    onUnsupported(response) {

        this.relayFailure();

        this.logger?.warn?.(
            `Unsupported response status: ${response.status}`
        );

        return {
            type: "unsupported",
            status: response.status,
        };
    }

    // ------------------------------------------------------------------
    // Cursor
    // ------------------------------------------------------------------

    updateCursor(headers) {

        const value =
            headers[SMERP_HEADERS.cursor];

        const nextCursor = Number(value);

        if (!Number.isSafeInteger(nextCursor)) {
            throw new Error("invalid cursor");
        }

        if (nextCursor <= this.relay.cursor) {
            throw new Error("cursor regression");
        }

        this.relay.cursor = nextCursor;
    }

    // ------------------------------------------------------------------
    // Relay health
    // ------------------------------------------------------------------

    relaySuccess() {

        this.relay.lastSuccessAt =
            this.clock.now();

        this.relay.failureCount = 0;
    }

    relayFailure() {

        this.relay.failureCount =
            (this.relay.failureCount ?? 0) + 1;

        this.relay.lastFailureAt =
            this.clock.now();

        this.relay.disabled =
            this.relay.failureCount > 2;
    }
}