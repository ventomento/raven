export class ResponseHandler {

    constructor({
        relay,
        logger = {
            info : () => console.info,
            warn : () => console.warn,
            error: () => console.error
        },
        clock = { 
            now: () => Date.now() 
        },
        storage,
        ingestor,
    }) {

        this.storage = storage;
        this.ingestor = ingestor;
        this.relay = relay;
        this.logger = logger;
        this.clock = clock;
        this.nextCursor = null;

        if (!(this.relay.cursor >= 0)) {
            throw new Error(
                "ResponseHandler Constructor: unexpected relay.cursor"
            );
        }
    }

    // returns next cursor if more records else null
    //
    async handle({ status, headers, body }) {

        if (status === 204) {
            this.handle204(status);
        }

        else if (status === 200) {
            await this.handle200(headers, body);
        }

        else {
            this.handleNot200(status);
        }

        // persist updated relay
        await this.storage.relaysPut(this.relay);

        return this.nextCursor;
    }

    handle204(status) {

        this.logger.info(
            "relay exhausted",
            {
                relay: this.relay,
                status,
            }
        );

        this.relaySuccess();
    }

    async handle200(headers, body) {

        const cursor = this.smerpHeaders(headers)?.id;

        if (this.invalidSmerpCursor(cursor)) {

            this.handleInvalidCursor(cursor);
        }

        else if (await this.ingestor.ingest(body)) {

            this.relaySuccess(cursor);
            this.nextCursor = this.relay.cursor;
        }

        else {
            this.logger.warn(
                "ingest rejected record",
                {
                    relay: this.relay,
                    cursor,
                }
            );
        }
    }

    handleInvalidCursor(cursor) {

        this.logger.warn(
            "relay disabled due to invalid next cursor (server doesn't implement protocol properly)",
            {
                relay: this.relay,
                cursor,
            }
        );

        this.relayFailure(true);
    }

    handleNot200(status) {

        this.logger.error(
            "relay transport failed",
            {
                relay: this.relay,
                status,
            }
        );

        this.relayFailure();

        if (this.relay.failureCount > 2) {
            this.relay.disabled = true;
        }
    }

    relaySuccess(cursor = null) {

        this.relay = {
            ...this.relay,

            lastSuccessAt: this.clock.now(),

            failureCount: 0, //reset failure count.

            cursor: cursor ?? this.relay.cursor,
        };

        if (cursor && (this.relay.cursor !== cursor)){
            throw new Error("logic error");
        }
    }

    relayFailure(disabled = false) {

        if (typeof disabled !== "boolean") {
            throw new Error("type error.");
        }

        this.relay = {
            ...this.relay,

            lastFailureAt: this.clock.now(),

            failureCount:
                (this.relay.failureCount ?? 0) + 1,

            disabled,
        };
    }

    invalidSmerpCursor(cursor) {

        return !(
            Number.isInteger(cursor) &&
            cursor > this.relay.cursor
        );
    }

    smerpHeaders(headers) {

        try {

            const meta = headers?.get?.("x-smerp");

            if (!meta) {
                return null;
            }

            return JSON.parse(meta);

        }

        catch {

            return null;
        }
    }
}