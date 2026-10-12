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
node playground/repl.js                         # REPL: 2 mock relays (:8001, :8002), clients alice/alice2/bob/carol
```

`playground/repl.js` imports `raven` and `raven/testing` by package self-reference, so it exercises the real `exports` map.

`smerp/src/storage/indexeddb/browser-test.html` exercises the IndexedDB storage in a browser.

## Architecture

A headless library: no UI ships with it. Two layers: `smerp` depends on `smep`; `smep` depends on nothing. Package entry points (`package.json` `exports`):
- `.` → `index.js`: the reference `SmerpClient` plus what a consumer needs to use it (identities, `EventTypes`, `ContentTypes`, storages, errors).
- `./smep` → `smep/src/index.js`: all primitives, for building a custom client.
- `./smerp` → `smerp/src/index.js`: client building blocks (storage/transport interfaces, sync, ingest, auth).
- `./testing` → `smerp/src/server/index.js`: mock relay. Uses `node:http`, so it must never be re-exported from `.` or `./smerp`.
- `./webui` → `webui/src/index.js`: browser UI (`WebUi`). Uses the DOM, so it must never be re-exported from `.` either.

Protocol specs (plain text, kept in sync with the code; the code is the source of truth): `smep/smep_rfc.txt` (envelope format, encryption), `smerp/smerp_rfc.txt` (relay upload/download, relay types, federation), `smerp/src/auth/auth_rfc.txt` (GET auth).

Classes are checked with `instanceof` via `insist`, so every module must import identities from `smep`, never a copy.

**smep** is the pure crypto/envelope protocol with no I/O. It uses only WebCrypto (`crypto.subtle`), so the same code runs in Node and the browser.
- Identities are X25519 keypairs held as `CryptoKey`s (`PrivateIdentity` / `PublicIdentity`). Peers are addressed by the hex public key, called **pkh** throughout (`spkh`/`rpkh` = sender/recipient).
- `encrypt` / `createEnvelope`: X25519 ECDH → `sha256(shared_secret)` as key (`kdf.js`) → AES-GCM with random IV → binary envelope (UUID, content type, keys, IV, ciphertext‖tag). Layout constants are in `envelope/layout.js`. `EnvelopeWriter` writes the 94-byte header first (`writeHeader` returns it as the AES-GCM AAD), then `writeBody`, then `finish`. Envelopes are at most 4 MiB in total (`EnvelopeLayout.MAX_SIZE`; writer and reader both enforce it). `readEnvelope` parses without decrypting (used for uuid dedup, relay validation) and exposes the received header bytes as `header`; decryption uses those, never re-serialized ones.
- `insist(value, Class?)` from `smep/src/util/util.js` is the runtime type check used in constructors across both layers.

**smerp** is the reference messaging client built around untrusted relays that store opaque encrypted envelopes. Dependencies point one way: `protocol/` → `relay/` → `inbox/`, `outbox/` → `client/`; `state/` is used by all of them and is the only writer of storage.
- `client/smerp-client.js` (`SmerpClient`) is a thin facade: lifecycle, the running-state guard, the sync interval, and delegation. `client/compose.js` (`composeClient`) builds the object graph on each start; `client/migrations.js` runs at start. Dependencies are injected via constructor options with defaults (`TransportDefault`, `StorageMemory`, silent `LightLog`, `RealClock`).
- Local storage access uses one naming convention across client and storage: `<resource>Get(options)` returns an array, `<resource>Put(record)` inserts or replaces by primary key, `<resource>Delete(options)` removes by primary key and returns a count. Resources: `envelopes` (key `uuid`), `conversations` (key `publicKeyHex`), `relays` (key `relayUrl`). Actions that go to the network are plain verbs instead (`send`, `sync`). All client methods throw `NotStartedError` unless `status === "running"`.
- UIs observe the client via `client.on(EventTypes.X, cb)` → unsubscribe. Events carry the stored record (`envelope`, `conversation`, `relay`), not just keys. Every storage write publishes the matching event; that is guaranteed by `state/` being the only writer.
- `state/message-store.js` (`MessageStore`) writes envelopes and conversations. `storeIfNew` runs dedup check → monotonic `receivedAt` → `envelopesPut` → conversation update under `writeLock`. Relays sync in parallel and hold the same envelopes, so without the lock duplicates get stored and counted twice (`smerp/tests/ingestor.test.js` reproduces this with IndexedDB-like async storage). Don't remove it. Conversations carry `unreadCount`, incremented for each inbound envelope; a UI resets it with `conversationsPut`. Writes are last-write-wins; races between a UI put and an ingest are accepted by design, so don't add versioning or locking for them.
- `state/relay-directory.js` (`RelayDirectory`) writes relay records. The user owns the config fields (`put`, `delete`); sessions merge the sync fields (`cursor`, `relayPkh`, health) with `recordProgress`, which returns null for a deleted relay so it is not resurrected. All relay writes share its `writeLock`.
- `protocol/` is the pure wire format, shared by the client and the mock relay: header names and status codes, `MAX_ENVELOPE_BYTES` / `MAX_BATCH_BYTES` (4 MiB each), request builders, `encodeBatch` / `decodeBatch`, `parseCursor`, `retryAfterMs`. `GET /envelopes` returns a batch: `frame*`, `frame = uint32 BE length || envelope`, `x-smerp-cursor` = after the last envelope.
- `relay/relay-session.js` (`RelaySession`) talks to one relay, in memory only. `exchange` is the only place relay requests are made: it signs, adds `Authorization: Bearer <relayToken>` if set, learns the relay key from `x-smerp-relay-pkh` (unsigned while none is known, retries a 401 once when the key changed). `get(consume)` and `post(bytes)` switch on the HTTP status directly. `get` hands the batch to `consume(frames, cursor)` and advances the cursor only after it resolves; consume throwing (storage) keeps the cursor and is not counted against the relay; a bad cursor keeps it and counts a failure; broken framing with a valid cursor consumes the frames before the break and moves on. The session owns cursor, relay key and health after creation and reports them through `onChange(state)`; `configure(relay)` only takes the access token. `notBefore()` = latest of next token, 429 pause and failure backoff (30 s doubling, 1 h cap).
- `relay/relay-pool.js` (`RelayPool`) runs the sessions of enabled relays. Each is in exactly one state: IDLE, READY, RUNNING, WAITING. A slot covers one request, not a relay: after every `get` the session gives the slot back and queues again. One `clock.timer` wakes the earliest WAITING session. `wakeIdle()` (what `client.sync()` calls) moves IDLE sessions to READY/WAITING and resolves when the round ends: nothing READY or RUNNING, and WAITING sessions are only parked (429 or backoff), which retry on their own. `runNow(relayUrl, fn)` runs a send ahead of sync steps and fails fast for a throttled relay. The client tells the pool about relay changes with `upsert` / `remove`.
- `relay/rate-limits.js` (`RelayRateLimits`) holds one `TokenBucket` per `relayUrl` (protects the relay), kept by the client so budgets survive a restart; the pool's slot count protects the client. `TokenBucket` never waits (`tryTake`, `nextTokenAt`, `pause`). Time comes from an injected clock (`now`, `sleep`, `timer`); in tests `VirtualClock` fires timers only on `advance(ms)` or `drive(promise)`.
- `inbox/` receives: `EnvelopeOpener` (`read` parses for the uuid, `open` decrypts and maps to a record; no storage) and `Ingestor.ingestBatch(frames, { relayUrl, cursor })`. Anything thrown while opening is a rejection (frame skipped, `rejected` event); anything thrown by `MessageStore` propagates so the cursor stays.
- `outbox/sender.js` (`Sender`): `send(recipientPublicKeyHex, plaintext, { contentType })` takes a `string` or `Uint8Array`, encrypts via smep (envelopes over 4 MiB are refused), POSTs to every enabled relay, throws `DispatchError` if none accepted it, and returns `{ uuid, delivered, failed }`. It stores nothing itself: every envelope, including our own, enters storage only through sync → `Ingestor` (a single ingestion path). It then wakes the pool.
- Auth (spec: `smerp/src/auth/auth_rfc.txt`) is stateless and mandatory on every request. HMAC key = hash of the X25519 shared secret between signer and relay. `auth/request-signer.js` holds it all: `canonicalRequest` (METHOD, target relative to the relay URL, timestamp, sha256(body)), `RequestSigner` (client) and `RequestVerifier` (relay). Headers: `x-smerp-pkh`, `x-smerp-timestamp`, `x-smerp-signature`; GET's mailbox is the signer. Every refusal is a 401 with optional free-text `x-smerp-unauthorized`, kept as `relay.lastFailureReason` (untrusted, display only). This replaced ed25519 signatures; `@noble/curves` is no longer used.
- `smerp/src/lib/` holds generic, non-smerp-specific building blocks: `ConcurrencyLimiter` (`ConcurrencyLimiter(1)` serves as the mutex for the write locks), `TokenBucket`, `RealClock`.
- Pluggable backends follow documented interface contracts: `storage/storage-interface.js` (gets return arrays of detached copies; implementations `StorageMemory`, `indexeddb/`; a new backend should run the shared ordering and pagination suite `storageContract(test, () => new Storage())` from `smerp/tests/helpers/storage-contract.js`) and `transport/transport-interface.js` (`transport({url, options, timeout}) → {status, headers, body: Uint8Array}`).
- `server/smerp-server.js` + `storage-server.js` are a **mock relay for testing only**: in-memory append-only record store on `node:http`, with a keypair generated per instance (or `privateKeyHex` option); `relayPkh()` returns it and `rotateKey()` replaces it. It serves batched GETs, refuses POST bodies over 4 MiB with 400, and requires signed GET and POST (POST signer must be the envelope's sender or recipient) and, with the `tokens` option (a Set), a bearer token. `smerp/tests/smerp-client.test.js` runs clients end-to-end against it on an ephemeral port; `relay-pool.test.js` runs the pool over `FakeRelays`. Register cleanup with `t.after` so a failing test can't hang the run.

**webui** is a browser UI on top of `SmerpClient` (third layer: webui → smerp → smep). Vanilla DOM, no dependencies.
- `new WebUi({ privateKeyHex, root = document.body, storage?, recipientPublicKeyHex?, relays? }).start()` derives the identity, creates the client with `IndexedDbStorage(publicKeyHex)` by default, adds each `relays` entry whose `relayUrl` is not already stored, opens the Send view prefilled when `recipientPublicKeyHex` is given, injects `styles/webui.css` via `import.meta.url`, and mounts `AppShell`. `stop()` tears it all down. The private key is never stored.
- `AppShell` (header, tab bar, active view) holds the UI's only `client.on` subscriptions and forwards each event to the active view. Views (`views/`) implement `mount(container)`, `onEvent(event)`, `unmount()` and never subscribe themselves. Reusable pieces live in `components/`.
- Peer content is untrusted: build DOM only with `h()` from `dom.js` (text nodes), never `innerHTML`.
- Display is text vs file only: `TEXT_UTF8` renders as text; any other content type gets a download button. Envelopes carry no filename or MIME type, so `file-type.js` guesses the extension from the file's leading bytes (no extension if unknown). Sending a file uses `ContentTypes.FILE`.
- Demo: run the mock relay, `python3 -m http.server 8080` from the repo root, open `http://localhost:8080/webui/demo/`. No relay key is needed; the client learns it.
