// smerp-server.js

import { HttpServer } from "./smerp-server.js";

const server =
  new HttpServer();

const PORT = 8080;

await server.listen(PORT);

console.log(
  `SMERP server listening on port ${PORT}`
);

// run
// node run-server.js