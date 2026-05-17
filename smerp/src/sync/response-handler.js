export class ResponseHandler {

    constructor({
        relay,
        logger, 
        storage,
        ingestor,
        clock = { 
            now: () => Date.now() 
        },
    }) {

        if (!logger){
            throw new Error("Void logger");
        }

        this.storage = storage;
        this.ingestor = ingestor;
        this.relay = relay;
        this.logger = logger;
        this.clock = clock;

        if (typeof relay.cursor === 'undefined') {
            this.relay.cursor = 0;
        }
    }

    // returns next cursor if more records else null
    //
    async handle({ status, headers, body }) {

        let hasMore = null;

        if (status === 204) {
            this.handle204(status);
        }

        else if (status === 200) {
            hasMore = await this.handle200(headers, body);
        }

        else {
            this.handleNot200(status);
        }

        // persist updated relay
        await this.storage.relaysPut(this.relay);

        return hasMore;
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

        const cursor = Number(this.smerpHeaders(headers)?.id);

        if (! this.validateSmerpCursor(cursor)) {
            this.relayFailure();
        }

        else if (await this.ingestor.ingest(body)) {
            this.relaySuccess(cursor);
            return cursor;
        }
        
        else {
            this.logger.warn(
                "ingest failed",
                {
                    relay: this.relay,
                    cursor,
                }
            );
            this.logger.debugAdd({msg: "ingest failed", relay: this.relay, cursor});
        }

        return null;
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
    }

    decideRelayFate(){
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

    relayFailure() {

        this.relay = {
            ...this.relay,

            lastFailureAt: this.clock.now(),

            failureCount:
                (this.relay.failureCount ?? 0) + 1,
        };

        this.decideRelayFate();
    }

    validateSmerpCursor(cursor) {

        const valid = Number.isInteger(cursor) && (cursor > this.relay.cursor);

        if (valid) {

            return true;

        } else {

            this.logger.warn(
                "Invalid next smerp cursor (server probably doesn't implement protocol properly)",
                {
                    relay: this.relay,
                    cursor,
                }
            );
            this.logger.debugAdd({msg: "Invalid smerp cursor. Likely server doesn't implement protocol properly"});

            return false;

        }
    }

    smerpHeaders(headers) {

        try {
            const meta = headers["x-smerp"];

            this.logger.debugAdd({msg: "RepsponseHandler, smerp headers - string", meta});

            if (!meta) {
                return null;
            }

            const smerpHeadersJson = JSON.parse(meta);
            this.logger.debugAdd({msg: "RepsponseHandler, smerp headers - json", smerpHeadersJson});

            return smerpHeadersJson;
        }

        catch {

            return null;
        }
    }
}