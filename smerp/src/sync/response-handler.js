import { insist } from "../../../smep/src/util/util.js";
import { Ingestor } from "../ingest/ingestor.js";

export class ResponseHandler {

    constructor({
        relay,
        logger,
        storage,
        ingestor,
        clock = {
            now: () => Date.now(),
        },
    }) {
        
        insist(relay);
        insist(logger);
        insist(storage);
        insist(ingestor, Ingestor);

        if (typeof relay.cursor === "undefined") {
            relay.cursor = 0;
        }

        this.relay = relay;

        this.deps = {
            logger,
            storage,
            ingestor,
            clock,
        };

        this.pipeline = [
            checkTransportError,
            checkExhausted,
            parseSmerpHeaders,
            validateSmerpCursor,
            ingestBody,
        ];

    }

    async handle(response) {

        const ctx = {
            ...this.deps,
            
            relay: this.relay,

            response,

            smerpHeaders: null,
            cursor: null,

            ingestOk: false,
            stop: false,
        };

        for (const step of this.pipeline) {

            if (ctx.stop) {
                break;
            }

            await step(ctx);
        }

        await ctx.storage.relaysPut(ctx.relay); // persist in storage
        this.relay = ctx.relay                  // update class instance (should be same obj anyways)

        // false unless ingest succeeded.
        return ctx.ingestOk;
    }
}

// --------------------------------------------------
// Pipe functions (mutators of ctx)
// --------------------------------------------------

async function checkTransportError(ctx) {

    const { status } = ctx.response;

    if (status === 200 || status === 204) {
        return;
    }

    ctx.logger.error(
        "relay transport failed",
        {
            relay: ctx.relay,
            status,
        }
    );

    relayFailure(ctx);
    ctx.stop = true;
}

async function checkExhausted(ctx) {

    if (ctx.response.status !== 204) {
        return;
    }

    relaySuccess(ctx);
    ctx.stop = true;
}

async function parseSmerpHeaders(ctx) {
    // sets ctx.cursor and ctx.smerpHeaders

    try {

        const meta =
            ctx.response.headers["x-smerp"];

        if (!meta) {
            return;
        }

        ctx.smerpHeaders =
            JSON.parse(meta);

        ctx.cursor =
            Number(ctx.smerpHeaders?.id);

    } catch (err) {

        ctx.logger.warn(
            "invalid smerp header json",
            {
                relay: ctx.relay,
                error: err.message,
            }
        );

        relayFailure(ctx);

        ctx.stop = true;
    }
}

async function validateSmerpCursor(ctx) {

    const valid =
        Number.isInteger(ctx.cursor) &&
        ctx.cursor > ctx.relay.cursor;

    if (valid) {
        return;
    }

    ctx.logger.warn(
        "invalid smerp cursor",
        {
            relay: ctx.relay,
            smerpHeaders: ctx.smerpHeaders,
            cursor: ctx.cursor,
        }
    );

    relayFailure(ctx);

    ctx.stop = true;
}

async function ingestBody(ctx) {
    ctx.logger.info("ResponseHandler attemting ingest");

    ctx.ingestOk =
        await ctx.ingestor.ingest(
            ctx.response.body
        );


    if (!ctx.ingestOk) {

        ctx.logger.info(
            "ingest failed",
            {
                relay: ctx.relay,
                cursor: ctx.cursor,
            }
        );

        ctx.stop = true;
        return;
    }

    // only update cursor if ingest succeeded
    relayUpdateCursor(ctx);
    relaySuccess(ctx);
}

// --------------------------------------------------
// Relay mutation helpers
// --------------------------------------------------

function relayUpdateCursor(ctx) {

    if (ctx.cursor <= ctx.relay.cursor) {
        throw new Error("cursor regression");
    }

    ctx.logger.info("relay updating cursor", {cursor: ctx.cursor, oldCursor:ctx.relay.cursor})
    ctx.relay.cursor = ctx.cursor;
}

function relaySuccess(ctx) {

    ctx.relay.lastSuccessAt =
        ctx.clock.now();

    ctx.relay.failureCount = 0;
}

function relayFailure(ctx) {

    ctx.relay.failureCount =
        (ctx.relay.failureCount ?? 0) + 1;

    ctx.relay.lastFailureAt =
        ctx.clock.now();

    ctx.relay.disabled =
        ctx.relay.failureCount > 2;
}