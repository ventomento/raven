import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { TransportDefault } from "../../src/transport/transport-default.js";

async function startServer(t, handler) {

    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    t.after(() => {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });

    return `http://127.0.0.1:${server.address().port}`;
}

test("returns status, lowercase headers and the body as bytes", async (t) => {

    const url = await startServer(t, (request, response) => {
        response.writeHead(200, { "X-Smerp-Cursor": "7", "content-type": "application/octet-stream" });
        response.end(Buffer.from([1, 2, 3]));
    });

    const response = await TransportDefault.transport({ url });

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
    });

    assert.deepEqual(seen, { method: "POST", header: "yes", body: Buffer.from([9, 8]) });
    assert.equal(response.status, 401);
    assert.equal(response.headers["x-smerp-unauthorized"], "no");
    assert.equal(response.body.byteLength, 0);
});

test("a request over its timeout fails with a timeout error", async (t) => {

    const url = await startServer(t, () => {});

    await assert.rejects(
        TransportDefault.transport({ url, timeout: 50 }),
        /timeout after 50ms/
    );
});

test("a refused connection rejects", async () => {

    await assert.rejects(TransportDefault.transport({ url: "http://127.0.0.1:1" }));
});

test("a body over maxBytes rejects, with or without Content-Length", async (t) => {

    for (const chunked of [false, true]) {

        const url = await startServer(t, (request, response) => {
            response.writeHead(200, chunked ? {} : { "content-length": "11" });
            if (chunked) {
                response.write(Buffer.alloc(6));
            }
            response.end(Buffer.alloc(chunked ? 5 : 11));
        });

        await assert.rejects(
            TransportDefault.transport({ url, maxBytes: 10 }),
            /larger than 10 bytes/,
            chunked ? "chunked" : "content-length"
        );
    }
});

test("a body of exactly maxBytes is returned whole; an empty one as empty bytes", async (t) => {

    const url = await startServer(t, (request, response) => {
        if (request.url === "/empty") {
            response.writeHead(204);
            response.end();
            return;
        }
        response.writeHead(200);
        response.write(Buffer.alloc(4, 1));
        response.end(Buffer.alloc(6, 2));
    });

    const full = await TransportDefault.transport({ url, maxBytes: 10 });
    assert.deepEqual(Array.from(full.body), [1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);

    const empty = await TransportDefault.transport({ url: `${url}/empty`, maxBytes: 10 });
    assert.equal(empty.status, 204);
    assert.ok(empty.body instanceof Uint8Array);
    assert.equal(empty.body.byteLength, 0);
});

test("redirects are not followed, even if the options ask for it", async (t) => {

    let reached = false;

    const target = await startServer(t, (request, response) => {
        reached = true;
        response.end();
    });

    const url = await startServer(t, (request, response) => {
        response.writeHead(302, { location: `${target}/envelopes` });
        response.end();
    });

    await assert.rejects(TransportDefault.transport({
        url,
        options: { redirect: "follow" },
    }));

    assert.equal(reached, false);
});
