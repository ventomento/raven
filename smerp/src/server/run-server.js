// Starts the mock relay on port 8000 with request logging.
// FOR DEVELOPMENT ONLY: see the warning at the top of smerp-server.js.

import { SmerpServer } from "./smerp-server.js";

const PORT = 8000;

const server = new SmerpServer();

server.server.on("request", (req, res) => {
    const startedAt = Date.now();
    console.log("REQ", req.method, req.url);
    res.on("finish", () => {
        console.log("RES", req.method, req.url, res.statusCode, `${Date.now() - startedAt}ms`);
    });
});

await server.listen(PORT);

console.warn("WARNING: mock relay for development only, never use it in production");
console.log(`SMERP mock relay listening on http://127.0.0.1:${PORT}`);
