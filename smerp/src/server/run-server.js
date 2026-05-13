// smerp-server.js

import { SmerpServer } from "./smerp-server.js";

const server = new SmerpServer();

const PORT = 8080;

await server.listen(PORT);

server.server.on("request", (req, res) => {

  const startedAt = Date.now();

  console.log(
    "REQ",
    req.method,
    req.url
  );

  res.on("finish", () => {

    console.log(
      "RES",
      req.method,
      req.url,
      res.statusCode,
      `${Date.now() - startedAt}ms`
    );
  });
});

console.log(
  `SMERP server listening on port ${PORT}`
);

// run
// node run-server.js