# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project discussion and docs live at the forum: https://www.depvana.com/topic/505

## Commands

There is no build step, linter, or npm script. Code is plain ES modules (`"type": "module"`) run directly by Node (v20) or the browser.

```sh
node --test smep/tests/ smerp/tests/ webui/tests/   # all tests (node:test + node:assert/strict)
node --test smep/tests/protocol.test.js         # single file
node --test --test-name-pattern="clamp" smep/tests/   # single test by name
node smerp/src/server/run-server.js             # mock relay on :8000
```

`smerp/src/storage/indexeddb/browser-test.html` exercises the IndexedDB storage in a browser.

## Architecture

A headless library: no UI ships with it. Two layers: `smerp` depends on `smep`; `smep` depends on nothing. Package entry points (`package.json` `exports`):
- `.` → `index.js`: the reference `SmerpClient` plus what a consumer needs to use it (identities, `EventTypes`, `ContentTypes`, storages, errors).
- `./smep` → `smep/src/index.js`: all primitives, for building a custom client.
- `./smerp` → `smerp/src/index.js`: client building blocks (storage/transport interfaces, sync, ingest, auth).
- `./testing` → `smerp/src/server/index.js`: mock relay. Uses `node:http`, so it must never be re-exported from `.` or `./smerp`.
- `./webui` → `webui/src/index.js`: browser UI (`WebUi`). Uses the DOM, so it must never be re-exported from `.` either.

Classes are checked with `instanceof` via `insist`, so every module must import identities from `smep`, never a copy.

**smep** is the pure crypto/envelope protocol with no I/O. It uses only WebCrypto (`crypto.subtle`), so the same code runs in Node and the browser.
- Identities are X25519 keypairs held as `CryptoKey`s (`PrivateIdentity` / `PublicIdentity`). Peers are addressed by the hex public key, called **pkh** throughout (`spkh`/`rpkh` = sender/recipient).
- `encrypt`: X25519 ECDH → `sha256(shared_secret)` as key (`kdf.js`) → AES-GCM with random IV → binary envelope (UUID, content type, keys, IV, ciphertext, tag) written by the hand-rolled big-endian `Serializer`.
- `insist(value, Class?)` from `smep/src/util/util.js` is the runtime type check used in constructors across both layers.

**smerp** is the reference messaging client built around untrusted relays that store opaque encrypted envelopes.
- `SmerpClient` is the client facade. It wires together identity, transport, storage, `EventBus`, logger, `SyncEngine`, and `Ingestor`. Dependencies are injected via constructor options with defaults (`TransportDefault`, `StorageMemory`, silent `LightLog`).
- Local storage access uses one naming convention across client and storage: `<resource>Get(options)` returns an array, `<resource>Put(record)` inserts or replaces by primary key, `<resource>Delete(options)` removes by primary key and returns a count. Resources: `envelopes` (key `uuid`), `conversations` (key `publicKeyHex`), `relays` (key `relayUrl`). Actions that go to the network are plain verbs instead (`send`, `sync`). All client methods throw `NotStartedError` unless `status === "running"`.
- Conversations carry `unreadCount`, incremented by `Ingestor` for each inbound envelope; a UI resets it with `conversationsPut`. Writes are last-write-wins. Races between a UI put and an ingest are accepted by design, so don't add versioning or locking for them.
- UIs observe the client via `client.on(EventTypes.X, cb)` → unsubscribe. Events carry the stored record (`envelope`, `conversation`, `relay`), not just keys. Every client method that writes storage must publish the matching event.
- `send(recipientPublicKeyHex, plaintext, { contentType })` takes a `string` or `Uint8Array`. It encrypts via smep and POSTs the envelope bytes to every relay. It throws `DispatchError` if none accepted it, and returns `{ uuid, delivered, failed }`. It stores nothing itself: every envelope, including our own, enters storage only through sync → `Ingestor.ingest` (a single ingestion path). `send` starts a sync; a `sync()` call made during a running sync schedules one rerun.
- `Ingestor.writeLock` serializes the dedup check and persist. Relays sync in parallel and hold the same envelopes, so without it duplicates get stored and counted twice (`smerp/tests/ingestor.test.js` reproduces this with IndexedDB-like async storage). Don't remove it.
- Receiving: `SyncEngine` syncs all non-disabled relays in parallel through a shared `ConcurrencyLimiter`. Per relay, an `EnvelopeStream` pages `GET /envelopes` using a persisted `relay.cursor` and the `x-smerp-*` headers. `Ingestor` decrypts each envelope, writes it to storage, and publishes `envelope` and `conversation` events.
- Auth (spec: `smerp/src/auth/auth_rfc.txt`) is stateless. HMAC key = hash of the X25519 shared secret between client and relay (`relay.relayPkh`). The client sends `x-smerp-timestamp` (Unix seconds) and `x-smerp-signature` = HMAC(timestamp). This replaced ed25519 signatures; `@noble/curves` is no longer used.
- Pluggable backends follow documented interface contracts: `storage/storage-interface.js` (gets return arrays of detached copies; implementations `StorageMemory`, `indexeddb/`) and `transport/transport-interface.js` (`transport({url, options, timeout}) → {status, headers, body}`).
- `server/smerp-server.js` + `storage-server.js` are a **mock relay for testing only**: in-memory append-only record store on `node:http`, with a fixed keypair (`SmerpServer.PUBLIC_KEY_HEX` is the `relayPkh`). `smerp/tests/smerp-client.test.js` runs clients end-to-end against it on an ephemeral port. Register cleanup with `t.after` so a failing test can't hang the run.

**webui** is a browser UI on top of `SmerpClient` (third layer: webui → smerp → smep). Vanilla DOM, no dependencies.
- `new WebUi({ privateKeyHex, root = document.body, storage? }).start()` derives the identity, creates the client with `IndexedDbStorage(publicKeyHex)` by default, injects `styles/webui.css` via `import.meta.url`, and mounts `AppShell`. `stop()` tears it all down. The private key is never stored.
- `AppShell` (header, tab bar, active view) holds the UI's only `client.on` subscriptions and forwards each event to the active view. Views (`views/`) implement `mount(container)`, `onEvent(event)`, `unmount()` and never subscribe themselves. Reusable pieces live in `components/`.
- Peer content is untrusted: build DOM only with `h()` from `dom.js` (text nodes), never `innerHTML`.
- Display is text vs file only: `TEXT_UTF8` renders as text; any other content type gets a download button. Envelopes carry no filename or MIME type, so `file-type.js` guesses the extension from the file's leading bytes (no extension if unknown). Sending a file uses `ContentTypes.FILE`.
- Demo: run the mock relay, `python3 -m http.server 8080` from the repo root, open `http://localhost:8080/webui/demo/`. The relay key is `SmerpServer.PUBLIC_KEY_HEX`.

## Current state

The sync/auth refactor is in progress:
- `auth_rfc.txt` specifies SHA-512/HMAC-SHA-512, but the code uses SHA-256/HMAC-SHA-256.
- 4 tests fail (auth-related: `protocol.auth.test.js`, `auth-protocol.test.js`, `authenticator.test.js`).
