# Planned feature: phone notifications via ntfy

Status: planned, not implemented.

## Goal

Get a notification on your phone when an envelope arrives, without running anything
besides the relay. The notification says only that something arrived:

> raven: new envelope received

No sender, no hash, no content. [ntfy](https://ntfy.sh) delivers it: the phone runs the
ntfy app (Android or iOS) and subscribes to a topic; the relay POSTs to that topic.

## Why the relay, not a watcher

The relay already knows when an envelope for a mailbox arrives, and could already withhold
it, so letting it send the notification adds no new trust. Users don't have to run a
separate process. Notifications are an optional relay capability: a relay that doesn't
support them answers 404, and the client says so.

## The topic is a secret, not the public key

Anyone who knows an ntfy topic can subscribe to it. If the topic were the public key, anyone
who knows your key could watch when you get mail. So the topic is a random-looking secret
that only the mailbox owner and the relays they registered it with know.

The client derives it from the private key, so it is never stored and is the same on every
device and every relay (one subscription in the ntfy app covers all relays that use the
same ntfy server):

```
topic = "raven-" + hex(sha256("smerp-ntfy-topic" || uint32BE(epoch) || privateKeyBytes))[0..32]
```

`epoch` starts at 0. If the topic leaks, the user bumps it to get a new topic without a new
identity, and registers again on each relay (the old topic is replaced). The client keeps
the epoch in storage; it is not secret.

The relay treats the topic as opaque and only checks its format (`^[A-Za-z0-9_-]{16,64}$`,
which also fits ntfy's topic rules). How a client makes it is a client matter; the
derivation above is the reference client's.

## Protocol sketch (smerp_rfc addition)

Three signed routes. As with `GET /envelopes`, the mailbox is the signer: you can only see
or set notifications for your own key.

```
GET    /notify                                 → 200 {"ntfyUrl", "enabled"} | 401 | 404 (unsupported)
POST   /notify    body: {"topic": "<topic>"}   → 200 {"ntfyUrl"} | 400 (bad topic) | 401 | 404
DELETE /notify                                 → 200 | 401 | 404
```

`POST` sets or replaces the mailbox's topic; `DELETE` removes it. `GET` tells a client the
state without changing it, so a fresh device can show each relay's status. The response
carries `ntfyUrl` because the client cannot build the subscribe URL `<ntfyUrl>/<topic>`
without it.

### When the relay pushes

Relay state per mailbox: `{ topic, armed, lastPushAt, lastGetAt, registeredAt }`.

When the relay stores an envelope it did not already hold (by `envelopeHash`), it pushes if
all of these hold:

- the recipient has a topic and is `armed`,
- the sender is not the recipient (notes to self don't notify),
- the cooldown has passed: `now - lastPushAt >= pushCooldown` (default 5 minutes).

It then sets `armed = false` and `lastPushAt = now` **synchronously**, before the push is
sent, so two concurrent uploads can't both push. A signed `GET /envelopes` by the mailbox
owner sets `armed = true` and updates `lastGetAt`.

So you get **at most one notification per check, and at most one per cooldown**. Both
bounds matter:

- `armed` limits spam: anyone can send you envelopes, but they trigger at most one push
  until you read the mailbox.
- The cooldown covers an open client. The client syncs every 60 s, and each sync re-arms,
  so without it the phone would buzz for nearly every message while you chat at a desktop,
  and each buzz costs relay budget (see limits below).

Not planned: suppressing pushes while the mailbox was read recently ("online"). It would
also mute the phone whenever a laptop with the client is left open, which is the case
notifications are for.

### The push

```
POST <ntfyUrl>/<topic>
Title: raven
X-Sequence-ID: raven
body: raven: new envelope received
```

`X-Sequence-ID` makes ntfy clients replace the previous notification with the same ID
instead of stacking a new one (Android and web; iOS still stacks). With every relay using
the same ID, enabling notifications on several relays gives redundancy without N
notifications per envelope on Android. Each relay still spends its own ntfy budget.

The push is fire-and-forget: short timeout, no retries, failures logged and ignored. It
never delays or fails the upload.

Relay config: `ntfyUrl` (default `https://ntfy.sh`; a self-hosted ntfy works too),
`ntfyToken` (optional access token, for a paid ntfy.sh plan or a protected server),
`pushCooldown`, and the push budget (below). The relay only ever POSTs to the configured
URL and never to a URL the client supplies, so a client can't make the relay call
arbitrary hosts.

### Registrations expire

A registration with no `GET /envelopes` for 90 days is removed, so abandoned mailboxes
stop receiving pushes. `lastGetAt` makes this a cheap periodic sweep.

## Relay implementation

### Storage

One record per mailbox, keyed by the recipient pkh, which the relay already reads from the
envelope header on upload:

```
notify: pkh (primary key) → { topic, armed, lastPushAt, lastGetAt, registeredAt }
```

- Mock relay: a `Map` in memory, next to `StorageServer`.
- Real relay: a persistent table (e.g. SQLite) is the source of truth, and the whole table is
  cached in a `Map`, so the upload path never touches disk.
- Writes are rare: `topic` changes only on `POST`/`DELETE /notify`; `armed` flips at most
  twice per push, so it is persisted only when it flips, never on every GET; `lastGetAt`
  only drives expiry, so it stays in memory and is flushed lazily (losing it on a crash
  only delays an expiry).

### Push pipeline

```
upload ──► store envelope (new hash?) ──► registry.get(rpkh)            O(1), in memory, no await
                                            │ armed, not self, cooldown passed
                                            ▼
                                   armed = false, lastPushAt = now       synchronous: no double push
                                            ▼
                                   pending.add(topic)                    a Set: coalesces by topic
                                            ▼
           dispatcher: K workers, keep-alive HTTP agent, global token bucket = ntfy budget
                       POST <ntfyUrl>/<topic> (short timeout, no retry)
                       429 → pause all pushes for Retry-After
                       budget exhausted → drop and count (best effort)
```

- The upload path is one map lookup and a Set insert; nothing in it awaits the push.
- The queue is bounded by the number of registered mailboxes (`armed` plus the cooldown
  allow at most one pending push per mailbox), so an envelope flood can't grow it.
- The relay keeps its own outbound budget matching its ntfy server's limits (for ntfy.sh
  free: burst 60, one per 5 s, 250 per day), so it slows down before ntfy answers 429 and
  never risks an IP ban.
- Total registrations are capped by config: a mailbox can only register its own key, but
  anyone can generate keys.

## ntfy.sh limits

ntfy.sh limits each **publisher** (by IP, an IPv6 /64), which here is the relay, shared by
all its users. Anonymous use (checked October 2026, docs.ntfy.sh/publish/#limitations):

| Limit          | ntfy.sh, anonymous                                                 |
|----------------|--------------------------------------------------------------------|
| Requests       | token bucket: burst 60, then 1 per 5 s (0.2/s); over that: 429     |
| Daily messages | 250 per day, reset at midnight UTC                                 |
| Message size   | 4,096 bytes                                                        |

250 per day is the real ceiling: at about 10 pushes per user per day, that is about 25
active users per relay. Fine for a personal relay, not for a public one. Repeated overruns
can get the IP banned for a while.

Options for a busier relay:

- **Paid ntfy.sh** with `ntfyToken`: limits follow the account, not the IP
  (Supporter 2,500, Pro 20,000, Business 50,000 messages per day).
- **Self-hosted ntfy**: limits are whatever you configure; add the relay to
  `visitor-request-limit-exempt-hosts`. Catch for **iOS**: instant delivery needs
  `upstream-base-url: https://ntfy.sh`, which forwards a `poll_request` to ntfy.sh for
  every message, counted against the ntfy server's IP. So the 250 per day applies again to
  iOS pushes unless `upstream-access-token` holds a paid plan's token.
- **`up`-prefixed topics** (to test, not to build on): with subscriber-based rate limiting
  enabled, pushes to `up*` topics count against the subscribing phone instead of the
  publisher. It needs the phone to hold a live stream (Android "instant delivery"; iOS
  probably gets HTTP 507), and it is off by default, so it depends on the ntfy server.

## Client sketch

- `SmerpClient`:
  - `notifyStatus(relayUrl)` → `{ supported, enabled, ntfyUrl }` via `GET /notify`
    (404 → `supported: false`).
  - `notifyEnable(relayUrl)` derives the topic, sends the signed `POST /notify` through
    that relay's session, and returns the subscribe URL `<ntfyUrl>/<topic>` built from the
    response's `ntfyUrl`.
  - `notifyDisable(relayUrl)` sends `DELETE /notify`.
  - `notifyRotate()` bumps the epoch and registers the new topic on every relay that had
    notifications enabled.
- webui, in two parts:
  - **Per relay**, in the relay list: a switch showing "on", "off" or "not supported",
    backed by `notifyStatus`. Registration, support and `ntfyUrl` really are per relay.
  - **Once**, a "Phone notifications" card for the phone setup: one subscribe URL per
    distinct `ntfyUrl` among the enabled relays (usually one), each with a QR code and a
    link, plus the guide below.
- Default to enabling one relay; more is allowed (redundancy, collapsed on Android by the
  sequence ID, stacked on iOS).

### Setup guide (shown in the card)

Without the ntfy app the topic does nothing, so the card says:

1. Install the ntfy app (Google Play, F-Droid or the App Store).
2. **Android**: scan the QR code or tap the link. It encodes
   `ntfy://<ntfy host>/<topic>?display=raven`, which opens the app and subscribes in one
   step (`ntfy://` deep links are Android only).
3. **iOS**: in the app, tap "+" and paste the topic. If the relay uses a server other than
   ntfy.sh, turn on "Use another server" and paste the server URL too.
4. Keep the topic private: anyone who has it can see when you get mail. If it leaks, use
   "New topic" (rotation) and subscribe again.

## What leaks, to whom

- **Relay**: nothing new (it already sees arrivals for your key), plus your topic.
- **ntfy server**: that some topic got a push at time T, and the relay's IP. It doesn't
  learn your public key. With self-hosted ntfy on iOS, ntfy.sh also sees the poll requests
  (a hash of the topic and the time).
- **Apple/Google push services**: that the ntfy app got a push at time T.
- **Anyone else**: nothing, as long as the topic stays secret.

## Open questions

- The topic is derived from the private key bytes; check that the identity can export them
  (WebUi has the hex; a non-extractable `CryptoKey` would need the derivation done at import).
- Whether ntfy.sh enables subscriber-based rate limiting, and whether the iOS app can
  register as a rate visitor (decides if `up` topics are usable).
- Email later as a second channel: it needs a confirmation step (anyone can register any
  address otherwise) and an operator-supplied mail provider, so it is out of scope here.
