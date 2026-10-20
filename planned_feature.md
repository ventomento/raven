# Planned feature: phone notifications via ntfy

Status: implemented, except the cooldown (see "When the sender pushes" and the open
questions). The normative parts (derivation, push, rules) are in smerp_rfc section 7; this
document keeps the reasoning.

## Goal

Get a notification on your phone when a peer sends you an envelope. The notification says
only that something arrived:

> raven: new envelope received

No sender name, no hash, no content. [ntfy](https://ntfy.sh) delivers it: the phone runs
the ntfy app (Android or iOS) and subscribes to a topic; the **sending client** POSTs to
that topic after a relay accepted the envelope. Relays are not involved.

## Why the sender, not the relay

- **Relays stay passive.** A relay only ever answers requests and never opens an outbound
  connection, so a volunteer can run one behind a firewall that drops everything else. No
  ntfy config, no outbound budget, no registry, no new routes.
- **The rate limit is per sender.** ntfy.sh limits each publisher IP (see limits below).
  With the sender publishing, every user has their own budget instead of all users of a
  relay sharing one.
- **One push per envelope**, however many relays it was sent to.
- **A clear contract, opt-in on both sides.** A sender chooses whether to push at all. A
  receiver chooses, per conversation, whether to listen (by subscribing to that
  conversation's topic). Neither needs the other's or a relay's cooperation to say no.

Accepted costs:

- **No notification for a first message.** You can only listen to a peer whose key you
  know. Unsolicited conversations are seen on the next sync and approved by listening.
- **One ntfy subscription per conversation** you want notifications for.
- **Notifications depend on the sender's client** supporting this and having it on.
- **ntfy sees who talks to whom** for listening pairs (see "What leaks").

## The topic

One topic per direction of a conversation, derived from the X25519 shared secret that the
two peers already compute for encryption, so only they can derive it:

```
shared = X25519(own private key, peer public key)
topic  = "raven-" + hex(sha256("smerp-ntfy-topic" || shared || rpkhBytes))[0..32]
```

- `rpkhBytes` (the recipient's 32-byte public key) makes it directional: Alice → Bob and
  Bob → Alice are different topics, so your own phone doesn't buzz when you send.
- The label separates it from the AES and HMAC keys, which are `sha256(shared)`.
- It is never stored: both clients derive it on demand, the same on every device.
- Being derived from ECDH, not the private key bytes, it works with a non-extractable
  `CryptoKey`.

A leaked topic reveals only when that one peer sends to you, which the peer already knows.
There is no rotation: if a topic leaks, unsubscribe from it (and the peer can turn pushing
off), or move to a new identity.

## When the sender pushes

After `send()` has at least one relay accepting the envelope (after the `DispatchError`
check), the client pushes if all of these hold:

- notifications are on in this client (the `notify` constructor option, off by default),
- the recipient is not ourselves (notes to self never push),
- we have received at least one envelope from that peer (`hasInbound` on the conversation,
  below).

The last rule means a cold first contact never pushes: only peers who have written to you
get pushed to. That is spam reduction for honest clients and keeps unanswered contacts out
of ntfy; a malicious sender can ignore it, but the receiver's opt-in is the real
protection, and a peer can only spam its own pair topic, which the receiver mutes by
unsubscribing.

The push is fire-and-forget: short timeout, no retry, failures logged (no topic in the
log) and ignored. It never delays `send()` or makes it fail.

Not yet: a cooldown. An active chat pushes on every message, which stacks notifications on
iOS and spends the sender's daily budget. The likely next rule is "and no push to this
peer in the last 5 minutes", possibly "unless the peer has replied since".

### The push

```
POST https://ntfy.sh/<topic>
Title: raven
X-Sequence-ID: raven
body: raven: new envelope received
```

`X-Sequence-ID` makes Android (and the web app) replace the previous notification of the
topic instead of stacking a new one; iOS ignores it and stacks.

**Browser support is verified** (October 2026): ntfy.sh answers the CORS preflight with
`access-control-allow-origin: *`, `access-control-allow-methods: GET, PUT, POST, PATCH,
DELETE`, `access-control-allow-headers: *`, and the POST with
`access-control-allow-origin: *`. The webui can push with a plain `fetch`.

### Configuration

Two `SmerpClient` constructor options, like `debug` and `concurrency`:

```js
new SmerpClient({ identity, notify: true, ntfyUrl: "https://ntfy.sh" })
```

- `notify` (default `false`): whether this client pushes. Changeable only by building a
  new client, so it is the embedding code's decision and nothing is stored.
- `ntfyUrl` (default `https://ntfy.sh`): "my ntfy server". The client pushes to it and
  builds subscribe links for it, so it matters even with `notify` off.

`WebUi` passes both through as options of its own; the page that embeds it decides (the
demo reads `?notify`, as it reads `?debug`). The webui has no switch for them.

The client only ever pushes to its own `ntfyUrl`, never to a server the peer names. A
peer-chosen URL would let a malicious peer point you at its own server and learn your IP
each time you message it, which relays otherwise hide. Both peers need the same server for
the topic to meet; for ntfy.sh, that is the default.

## The conversation flag

The conversation record gains `hasInbound: true`, set by the Ingestor on the first
envelope from the peer (inbound, not a note to self). Every other write copies the
existing record, as with `name`, so it survives. Checking it on send is one record lookup,
no envelope scan.

Conversations stored before the flag exists don't have it until the peer sends again, so
existing contacts get no pushes until they write once more. Acceptable; no migration.

## Receiving: subscribe on the phone

The receiver's opt-in is the ntfy subscription itself; the client stores nothing for it.
Listening is independent of the receiver's own `notify` option, so the UI offers it
always.

### The subscribe dialog

A bell button in the thread header opens a dialog for the topic "peer → me":

> Get a phone notification when \<name\> messages you. Install the ntfy app, then scan
> this code.

It always shows everything, in two sections side by side (stacked on a narrow screen),
with no toggle and no guessing between phone and desktop. One QR code can't serve both
platforms, so each section has its own:

- **Android**:
  - a QR code of `ntfy://<ntfy host>/<topic>?display=<name>`; scanning it opens the app
    and subscribes in one step;
  - the same URL as an "Open in ntfy" link, for when the dialog is open on the phone;
  - the topic with a copy button.
- **iPhone**:
  - a QR code of the plain topic text; the camera shows it, the user copies it and pastes
    it into the app's "+";
  - the topic with a copy button, for when the dialog is open on the phone: copy, open
    ntfy, tap "+", paste.

The topic is shown in a selectable text field next to its copy button
(`navigator.clipboard.writeText`), which is the fallback where the clipboard API is
unavailable (it needs HTTPS or localhost). Below both sections: the server URL, only when
it isn't ntfy.sh, and one line: anyone who has this topic can see when this peer messages
you.

Guide lines in the dialog:

- Install the ntfy app (Google Play, F-Droid or the App Store).
- iPhone: leave "Use another server" off for ntfy.sh (on, with the server URL, otherwise).
  Allow notifications when asked. Rename the subscription after the contact, or it shows
  as `raven-3f9a…`.
- If notifications stop, delete the subscription in the app and add it again.

The QR code needs an encoder, and the repo has no dependencies, so the webui gets its own
small one in `components/`: byte mode, one error-correction level, versions up to about 5
(the topic is 38 characters, the `ntfy://` link about 70). It is the largest piece of
webui work in the feature. A first version could ship without it (copy button and Android
link only), but then a desktop user has no good way to get the topic to the phone.

### iOS specifics

- The Camera app reads QR codes, but the ntfy iOS app registers no link that subscribes:
  `ntfy://` does nothing and `https://ntfy.sh/<topic>` opens the ntfy web app in Safari.
  Hence plain topic text and a paste.
- Delivery from ntfy.sh is near-instant: ntfy.sh is connected to APNs (through Firebase)
  and wakes the app, which fetches the message.
- Known flakiness: if notifications stop, deleting and re-adding the subscription
  re-subscribes it with Firebase (ntfy known issues).

## ntfy.sh limits

ntfy.sh limits each **publisher** (by IP, an IPv6 /64), here the sender. Anonymous use
(checked October 2026, docs.ntfy.sh/publish/#limitations):

| Limit          | ntfy.sh, anonymous                                                 |
|----------------|--------------------------------------------------------------------|
| Requests       | token bucket: burst 60, then 1 per 5 s (0.2/s); over that: 429     |
| Daily messages | 250 per day, reset at midnight UTC                                 |
| Message size   | 4,096 bytes                                                        |

250 pushes a day is plenty for one person's sends, less so with many users behind one IP
(CGNAT, an office). A 429 is ignored like any failed push; the client can stop pushing
until the `Retry-After` has passed.

## Client sketch

- **smep**: `notifyTopic(identity, peerPublicIdentity, recipientPublicKeyHex)` next to the
  other derivations, so third-party clients have one specified function.
- **SmerpClient**:
  - constructor options `notify` (default `false`) and `ntfyUrl` (default
    `https://ntfy.sh`);
  - `send()` pushes per the rules above;
  - `notifyTopic(publicKeyHex)` returns the topic the peer pushes to us on, and
    `ntfyUrl` is readable, for the subscribe dialog.
- **Ingestor**: sets `hasInbound` on the conversation.
- **webui**:
  - `WebUi` options `notify` and `ntfyUrl`, passed to the client; the demo reads `?notify`;
  - the subscribe dialog (receiver opt-in) and a QR encoder in `components/`.
- **Spec**: the derivation, the push and the push rules (cooldown as a SHOULD) go in a
  short client-side spec section, since they are neither envelope format nor relay
  protocol.

## What leaks, to whom

- **Relay**: nothing new.
- **ntfy server**: for listening pairs, the sender's IP publishing to a topic and the
  receiver's phone subscribing to it, with timing: who talks to whom. It doesn't learn
  public keys or content. Pushes to topics nobody listens to still show the sender's IP
  and timing.
- **Apple/Google push services**: that the ntfy app got a push at time T.
- **The peer**: nothing it doesn't know.
- **Anyone else**: nothing, as long as the topic stays secret.

## Considered: relays push

The earlier plan had the receiver register a topic with each relay, and the relay push on
upload (armed until the next read, a cooldown, a relay-wide budget). It notifies on first
contact and needs one subscription in total, but it makes relays open outbound
connections, puts all of a relay's users on one ntfy budget (about 25 active users on
ntfy.sh free), needs routes, a registry and expiry on every relay, and gives one push per
relay. Dropped for the reasons under "Why the sender".

## Open questions

- Whether the iOS camera's copy of a plain-text QR code works as described (untested on a
  device).
- An "I'm listening" control envelope so a sender pushes only to peers who subscribed:
  less ntfy traffic and metadata, but it needs a content type the webui hides.
- The cooldown rule (above).
