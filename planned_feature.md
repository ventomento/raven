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
device and every relay (one subscription in the ntfy app covers all relays):

```
topic = "raven-" + hex(sha256("smerp-ntfy-topic" || privateKeyBytes))[0..32]
```

The relay treats the topic as opaque and only checks its format (`^[A-Za-z0-9_-]{16,64}$`).
How a client makes it is a client matter; the derivation above is the reference client's.

## Protocol sketch (smerp_rfc addition)

Two signed routes. As with `GET /envelopes`, the mailbox is the signer: you can only set
notifications for your own key.

```
POST   /notify    body: {"topic": "<topic>"}   → 200 | 400 (bad topic) | 401 | 404 (unsupported)
DELETE /notify                                 → 200 | 401 | 404
```

`POST` sets or replaces the mailbox's topic; `DELETE` removes it.

Relay state per mailbox: `{ topic, armed }`.

- **Push**: when the relay stores an envelope it did not already hold (by `envelopeHash`),
  for a recipient that has a topic and is `armed`, it POSTs `raven: new envelope received`
  to `<ntfyUrl>/<topic>`, then sets `armed = false`. It skips envelopes whose sender is the
  recipient (notes to self).
- **Re-arm**: a signed `GET /envelopes` by the mailbox owner sets `armed = true`.

So you get **one notification per check**, not one per envelope. This also limits spam:
anyone can send you envelopes, but they trigger at most one push until you read the mailbox.

The push is fire-and-forget: short timeout, no retries, failures logged and ignored. It
never delays or fails the upload.

Relay config: `ntfyUrl` (default `https://ntfy.sh`; a self-hosted ntfy works too). The
relay only ever POSTs to this configured URL and never to a URL the client supplies, so a
client can't make the relay call arbitrary hosts.

## Client sketch

- `SmerpClient`: `notifyEnable(relayUrl)` derives the topic, sends the signed `POST /notify`
  through that relay's session, and returns the subscribe URL `<ntfyUrl>/<topic>`;
  `notifyDisable(relayUrl)` sends `DELETE /notify`.
- webui: a "Phone notifications" card shows the subscribe URL (and a QR code) to paste into
  the ntfy app.
- Enable it on **one relay**: every relay that has the topic pushes on its own, so N relays
  would mean up to N notifications for one envelope.

## What leaks, to whom

- **Relay**: nothing new (it already sees arrivals for your key), plus your topic.
- **ntfy server**: that some topic got a push at time T. It doesn't learn your public key.
  With self-hosted ntfy on iOS, `upstream-base-url: https://ntfy.sh` is needed for instant
  delivery; ntfy.sh then sees only a hash of the topic.
- **Anyone else**: nothing, as long as the topic stays secret.

## Open questions

- ntfy.sh rate-limits by sender IP. Fine for a personal relay; a busy relay should self-host
  ntfy or use a paid plan. Check the current limits before relying on ntfy.sh.
- Should registrations expire (e.g. after 90 days without a GET) so abandoned topics stop
  receiving pushes?
- The topic is derived from the private key bytes; check that the identity can export them
  (WebUi has the hex; a non-extractable `CryptoKey` would need the derivation done at import).
- Email later as a second channel: it needs a confirmation step (anyone can register any
  address otherwise) and an operator-supplied mail provider, so it is out of scope here.
