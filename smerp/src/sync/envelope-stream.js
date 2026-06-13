import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { TransportDefault } from "../transport/transport-default.js";
import { RequestBuilder } from "../request/request-builder.js";
import { AuthHandler } from "../auth/auth-handler.js";

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

        this.authHandler = new AuthHandler({
            identity,
            relay,
            transporter,
        });
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    async next() {

        let result = await this.processResponse(
            await this.envelopesGet()
        );

        if (result?.type === "reauth") {

            result = await this.processResponse(
                await this.envelopesGet()
            );
        }

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
                headers: await this.authHandler.getHeaders(),
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

        const expired =
            response.headers
                .get(SMERP_HEADERS.unauthorized)
                ?.toLowerCase() === "expired";

        if (!expired) {

            this.relayFailure();

            return {
                type: "protocol-error",
            };
        }

        this.relaySuccess();

        this.authHandler.clearSession();

        return {
            type: "reauth",
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
            headers.get(SMERP_HEADERS.cursor);

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