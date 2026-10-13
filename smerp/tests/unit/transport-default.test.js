import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { TransportDefault } from "../../src/transport/transport-default.js";
import { RecordingLogger } from "../helpers/relay-fixtures.js";

// TransportDefault against a local HTTP server.

async function startServer(t, handler) {

    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    t.after(() => {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });

    return `http://127.0.0.1:${server.address().port}`;
}

test("throws without a logger", async () => {

    await assert.rejects(TransportDefault.transport({ url: "http://127.0.0.1:1" }), /logger/);
});

test("returns status, lowercase headers and the body as bytes", async (t) => {

    const url = await startServer(t, (request, response) => {
        response.writeHead(200, { "X-Smerp-Cursor": "7", "content-type": "application/octet-stream" });
        response.end(Buffer.from([1, 2, 3]));
    });

    const response = await TransportDefault.transport({ url, logger: new RecordingLogger() });

    assert.equal(response.status, 200);
    assert.equal(response.headers["x-smerp-cursor"], "7");
    assert.ok(response.body instanceof Uint8Array);
    assert.deepEqual(Array.from(response.body), [1, 2, 3]);
});

test("sends method, headers and body; non-200 statuses are returned, not thrown", async (t) => {

    let seen;

    const url = await startServer(t, (request, response) => {

        const chunks = [];
        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => {
            seen = { method: request.method, header: request.headers["x-test"], body: Buffer.concat(chunks) };
            response.writeHead(401, { "x-smerp-unauthorized": "no" });
            response.end();
        });
    });

    const response = await TransportDefault.transport({
        url,
        options: { method: "POST", headers: { "x-test": "yes" }, body: new Uint8Array([9, 8]) },
        logger: new RecordingLogger(),
    });

    assert.deepEqual(seen, { method: "POST", header: "yes", body: Buffer.from([9, 8]) });
    assert.equal(response.status, 401);
    assert.equal(response.headers["x-smerp-unauthorized"], "no");
    assert.equal(response.body.byteLength, 0);
});

test("a request over its timeout fails with a timeout error", async (t) => {

    const url = await startServer(t, () => { /* never answers */ });

    await assert.rejects(
        TransportDefault.transport({ url, timeout: 50, logger: new RecordingLogger() }),
        /timeout after 50ms/
    );
});

test("a refused connection rejects", async () => {

    await assert.rejects(TransportDefault.transport({ url: "http://127.0.0.1:1", logger: new RecordingLogger() }));
});
