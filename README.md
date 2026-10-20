# raven

End-to-end encrypted messaging over untrusted relays, as a headless JavaScript library.

Messages are sealed into encrypted envelopes (X25519 + AES-GCM) and posted to any number of relays, which only store and forward opaque bytes. The client syncs from all its relays, deduplicates, decrypts and keeps a local message store.

No dependencies: plain ES modules on WebCrypto, running in Node 20+ and modern browsers. Distributed as an npm package.

Discussion and documentation: <https://www.depvana.com/topic/505>

## Usage

```js
import { SmerpClient, PrivateIdentity, EventTypes } from "raven";

const identity = await PrivateIdentity.generate();
const client = new SmerpClient({ identity });

await client.start();
await client.relaysPut({ relayUrl: "https://relay.example.org", relayType: "relay" });
await client.sync();

await client.send(peerPublicKeyHex, "hello");
const messages = await client.envelopesGet({ publicKeyHex: peerPublicKeyHex, limit: 50 });
```

Peers are addressed by their hex public key. The library never stores the private key.

## Entry points

| Import          | Contents |
|-----------------|----------|
| `raven`         | `SmerpClient`, identities, `EventTypes`, `ContentTypes`, storages, errors |
| `raven/smep`    | Crypto primitives and the envelope protocol |
| `raven/smerp`   | Building blocks for a custom client (storage, transport, sync, auth) |
| `raven/testing` | Mock relay for tests (Node only) |
| `raven/webui`   | Browser UI on top of `SmerpClient` (browser only) |

## Development

```sh
node --test smep/tests/ smerp/tests/ webui/tests/   # tests
node smerp/src/server/run-server.js                 # mock relay on :8000
node playground/repl.js                             # REPL with relays and clients
```

Protocol specs: `smep/smep_rfc.txt`, `smerp/smerp_rfc.txt`, `smerp/src/auth/auth_rfc.txt`.
