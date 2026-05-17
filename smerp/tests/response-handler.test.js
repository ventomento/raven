import test from "node:test";
import assert from "node:assert/strict";

import { ResponseHandler }
    from "../src/sync/response-handler.js";

function createDeps(overrides = {}) {

    const relay = {
        url: "relay.test",
        cursor: 10,
        failureCount: 0,
    };

    const logger = {
        info() {},
        warn() {},
        error() {},
    };

    const storage = {
        calls: [],

        async relaysPut(relay) {
            this.calls.push(relay);
        },
    };

    const ingestor = {
        async ingest() {
            return true;
        },
    };

    const clock = {
        now: () => 12345,
    };

    return {
        relay,
        logger,
        storage,
        ingestor,
        clock,
        ...overrides,
    };
}

test("successful ingest advances cursor", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 200,

            headers: {
                "x-smerp":
                    JSON.stringify({ id: 11 }),
            },

            body: ["hello"],
        });

    assert.equal(result, true);

    assert.equal(
        deps.relay.cursor,
        11
    );

    assert.equal(
        deps.relay.failureCount,
        0
    );

    assert.equal(
        deps.relay.lastSuccessAt,
        12345
    );

    assert.equal(
        deps.storage.calls.length,
        1
    );
});

test("204 marks relay exhausted", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 204,
            headers: {},
            body: [],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.failureCount,
        0
    );

    assert.equal(
        deps.relay.lastSuccessAt,
        12345
    );
});

test("transport failure increments failure count", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 500,
            headers: {},
            body: [],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.failureCount,
        1
    );

    assert.equal(
        deps.relay.lastFailureAt,
        12345
    );
});

test("relay disables after three failures", async () => {

    const deps = createDeps({
        relay: {
            url: "relay.test",
            cursor: 10,
            failureCount: 2,
        },
    });

    const handler =
        new ResponseHandler(deps);

    await handler.handle({
        status: 500,
        headers: {},
        body: [],
    });

    assert.equal(
        deps.relay.failureCount,
        3
    );

    assert.equal(
        deps.relay.disabled,
        true
    );
});

test("invalid smerp cursor increments failure count", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 200,

            headers: {
                "x-smerp":
                    JSON.stringify({ id: 5 }),
            },

            body: [],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.failureCount,
        1
    );

    assert.equal(
        deps.relay.cursor,
        10
    );
});

test("invalid smerp json increments failure count", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 200,

            headers: {
                "x-smerp": "{bad json",
            },

            body: [],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.failureCount,
        1
    );

    assert.equal(
        deps.relay.cursor,
        10
    );
});

test("missing smerp header increments failure count", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 200,
            headers: {},
            body: [],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.failureCount,
        1
    );
});

test("ingest failure does not update cursor", async () => {

    const deps = createDeps({
        ingestor: {
            async ingest() {
                return false;
            },
        },
    });

    const handler =
        new ResponseHandler(deps);

    const result =
        await handler.handle({
            status: 200,

            headers: {
                "x-smerp":
                    JSON.stringify({ id: 11 }),
            },

            body: ["hello"],
        });

    assert.equal(result, false);

    assert.equal(
        deps.relay.cursor,
        10
    );

    assert.equal(
        deps.relay.failureCount,
        0
    );
});

test("storage persists relay after processing", async () => {

    const deps = createDeps();

    const handler =
        new ResponseHandler(deps);

    await handler.handle({
        status: 204,
        headers: {},
        body: [],
    });

    assert.equal(
        deps.storage.calls.length,
        1
    );

    assert.equal(
        deps.storage.calls[0],
        deps.relay
    );
});