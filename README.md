# raven

End-to-end encrypted messaging over untrusted relays, as a headless
JavaScript library.

Messages are sealed into encrypted envelopes (X25519 + AES-GCM) and posted
to any number of relays, which only store and forward opaque bytes. The
client syncs from all of its relays, deduplicates, decrypts and keeps a
local message store.

- No dependencies: plain ES modules on WebCrypto.
- Runs in Node 20+ and modern browsers.
- TypeScript declarations included.


## Install

```sh
npm install @ventomento/raven
```


## Usage

```js
import { SmerpClient, PrivateIdentity } from "@ventomento/raven";

const identity = await PrivateIdentity.generate();
const client = new SmerpClient({ identity });

await client.start();
await client.relaysPut({ relayUrl: "https://relay.example.org", relayType: "relay" });
await client.sync();

await client.send(peerPublicKeyHex, "hello");
const messages = await client.envelopesGet({ publicKeyHex: peerPublicKeyHex, limit: 50 });
```

Peers are addressed by their public key in hex. The library never stores
the private key.

### Relay types

Each relay's operator states its type:

- **archive** keeps envelopes indefinitely.
- **relay** makes no retention promise, typically keeping envelopes until
  you have downloaded them, or for about a week.

Neither type guarantees delivery.


## Entry points

    @ventomento/raven         SmerpClient, identities, EventTypes,
                              ContentTypes, storages, errors

    @ventomento/raven/smep    Identities, envelopes and encryption

    @ventomento/raven/smerp   Building blocks for a custom client or a
                              relay: storage, transport, wire format,
                              sync, ingest, request signing and
                              verification

    @ventomento/raven/webui   Browser UI on top of SmerpClient
                              (browser only)

Only what these entry points export is public API. The version stays at
0.x while the protocol can still change, so a minor release may break it.


## Development

```sh
node --test smep/tests/ smerp/tests/ webui/tests/   # run the tests
node smerp/tests/server/run-server.js               # mock relay on :8000
node playground/repl.js                             # REPL with relays and clients
```

The tests, the mock relay, the playground and the web UI demo live only in
the repository. The npm package holds the library and the protocol specs.


## Protocol specs

- docs/smep_rfc.txt: envelope format and encryption
- docs/smerp_rfc.txt: relay upload and download, relay types, federation,
  notifications
- docs/auth_rfc.txt: request authentication


## License

Copyright (C) 2026 ventomento

Licensed under the Mozilla Public License 2.0. See LICENSE.
