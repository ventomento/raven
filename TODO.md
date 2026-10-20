# TODO: security review findings

From the security review of smep and smerp (2026-10-13). Items 1 and 2 were
confirmed with a proof-of-concept against the real `Ingestor`; the rest come
from reading the code.

## High

- [ ] **1. Peers can forge "sent by you" messages.**
  The envelope key `SHA256(X25519(a, B))` is the same for both parties, so Mallory
  can build a valid envelope with `sender = Alice, recipient = Mallory` using only
  her own key. Alice's mailbox includes envelopes she "sent", it decrypts, and
  `smerp/src/ingest/ingestor.js:194` marks it `outbound`; the web UI shows it as
  "You" (`webui/src/views/thread-view.js:133`). The mock relay accepts it because
  the signer (Mallory) is the recipient.
  Fix options:
  - Add a proof only the sender can make, e.g. `HMAC(SHA256(X25519(a, A)), header)`
    inside the plaintext (works across devices sharing the identity).
  - Or reject self-sent envelopes whose hash we never sent (breaks multi-device).
  - Full fix: per-message sender signatures (Ed25519), a protocol change.
  Needs smep_rfc changes.

- [x] **2. uuid squatting lets one hostile relay/peer drop a chosen message.**
  The uuid is plaintext in the header and the client dedups on uuid alone before
  decrypting (`smerp/src/ingest/ingestor.js:161`). Anyone who sees Alice→Bob's
  uuid U (any relay or federation peer) can send a valid `Mallory→Bob` envelope
  with uuid U; if Bob gets it first, Alice's real envelope is skipped everywhere.
  Relays do the same (`smerp/src/server/storage-server.js:67`, smerp_rfc section 5):
  a duplicate uuid is answered 200 and not stored or forwarded, so the sender's
  `send()` still reports success. Defeats "use several relays".
  Fix:
  - Client: dedup on `(uuid, sender, recipient)` or a hash of the full envelope.
  - Relays: a uuid is a duplicate only if the bytes are identical.
  Needs smerp_rfc changes.
  Done: the uuid is gone; an envelope's hash is sha256 of its bytes
  (`envelopeHash`, smep_rfc section 6), and clients and relays dedup only on it.

## Medium

- [x] **3. A malicious relay can keep sync from ever finishing.**
  A relay that always returns 200 with a bigger cursor, or a 401 with a new relay
  key, makes `step()` keep returning `true`. The scheduler's `whenDone` never
  resolves, so `sync()` never resolves and `SYNC end` never fires for any relay,
  while the client keeps fetching at ~2 req/s.
  Fix: cap steps per session per sync.
  Done: `Scheduler` gives each session at most `maxStepsPerRound` (50) steps
  per round; a wake during the round does not restart a capped session.

- [x] **4. No limit on response size.**
  `smerp/src/transport/transport-default.js:38` reads the whole body with
  `arrayBuffer()`; a relay can send gigabytes within the 30 s timeout.
  Fix: stream the body and abort past `MAX_BATCH_BYTES` plus framing.
  Done: `TransportDefault` streams and rejects past `maxBytes`
  (default `MAX_RESPONSE_BYTES`, the largest valid batch with framing).

- [ ] **5. Sender-chosen timestamps drive ordering.**
  `sentAt` comes from the sender's clock and sets `lastMessageAt`
  (`smerp/src/ingest/ingestor.js:221`). A peer can date messages in the future to
  pin their conversation on top, or backdate into old history.
  Fix: clamp to `receivedAt` plus an allowed skew.

## Low / hardening

- [ ] **6. Same key for HMAC auth and AES-GCM envelopes.**
  The client–relay request-signing key equals the envelope key for that pair
  (auth_rfc section 3), and the relay chooses its announced key. No practical
  attack found, but one key for two primitives is unsound.
  Fix: derive separately with HKDF and labels (`"smep-envelope"`, `"smerp-auth"`).

- [x] **7. Fetch follows redirects.**
  A relay can redirect signed requests to another origin.
  Fix: `redirect: "error"` in `TransportDefault`.
  Done, set after the caller's options so they cannot override it.

- [ ] **8. Insecure relay URLs accepted.**
  `relaysPut` accepts `http://` and then sends the access token in cleartext.
  Fix: require `https:` except for localhost.

- [ ] **9. Messages stored unencrypted; keys extractable.**
  IndexedDB holds decrypted plaintext, readable by anyone with device access or
  script on the origin. Keys are created with `extractable: true`.

- [x] **10. Mock relay unsafe to expose.**
  `GET /dump` serves every envelope without auth, `listen` defaults to `0.0.0.0`,
  and bodies without Content-Length have no size limit. Fine for tests; keep it
  off the network (default to `127.0.0.1`, drop or guard `/dump`, cap body size).
  Done: `listen` defaults to `127.0.0.1`, POST bodies are capped while streaming,
  and `smerp-server.js` states it is for development only. `/dump` is kept on
  purpose (metadata only, no envelope bytes).

- [ ] **11. Known design limits (already in the RFCs).**
  No forward secrecy; relays and the network see who talks to whom and when;
  requests can be replayed within the 300 s window. Nothing to fix unless these
  properties are wanted.
