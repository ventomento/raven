// Interactive playground: two mock relays, four clients, one REPL.
//
//   node playground/repl.js
//
// Clients (each with its own in-memory storage, all on both relays):
//   alice   Alice's first device
//   alice2  Alice's second device, same identity as alice (multi-device sync)
//   bob     Bob
//   carol   Carol
//
// On start, alice sends one message each to bob and carol. Everything
// is in memory and gone when the REPL exits.
//
// Try:
//   await alice.send(bob.publicKeyHex, "hi")
//   await show(bob)                    envelopes as a table
//   await bob.conversationsGet()
//   await alice2.sync(); await show(alice2)   alice's sent envelopes arrive on her second device
//   relays[0].server.storage.records   what a relay holds (opaque)
//   await relays[1].server.close()     take a relay down, then send again
//   log.verbose = true                 also show sync/relay events and full payloads
//   log.enabled = false                silence events

import repl from "node:repl";
import { SmerpClient, PrivateIdentity, EventTypes, ContentTypes } from "raven";
import { SmerpServer } from "raven/testing";

const RELAY_PORTS = [8001, 8002];

const log = { enabled: true, verbose: false };

// Fire on every sync (relay events are cursor saves), so verbose only.
const NOISY = [EventTypes.SYNC, EventTypes.RELAY];
const names = new Map(); // publicKeyHex -> name

let replServer = null;

function nameOf(publicKeyHex) {
  return names.get(publicKeyHex) ?? publicKeyHex.slice(0, 10) + "…";
}

function text(plaintext) {
  return plaintext instanceof Uint8Array
    ? new TextDecoder().decode(plaintext)
    : String(plaintext);
}

function summarize(event) {
  switch (event.type) {
    case EventTypes.ENVELOPE: {
      const e = event.envelope;
      const arrow = e.direction === "outbound" ? "→" : "←";
      return `${arrow} ${nameOf(e.publicKeyHex)}: "${text(e.plaintext)}"`;
    }
    case EventTypes.CONVERSATION: {
      const c = event.conversation;
      return `${nameOf(c.publicKeyHex)} unread=${c.unreadCount}${event.created ? " (new)" : ""}`;
    }
    case EventTypes.RELAY:
      return `${event.relay.relayUrl}${event.deleted ? " deleted" : ""}`;
    case EventTypes.SYNC:
      return event.phase;
    case EventTypes.STATUS:
      return event.status;
    case EventTypes.REJECTED:
      return `${event.relayUrl} cursor=${event.cursor} ${event.reason}`;
    case EventTypes.ERROR:
      return `${event.relayUrl ?? ""} ${event.error?.message ?? event.error}`;
    default:
      return "";
  }
}

function print(...args) {
  console.log(...args);
  replServer?.displayPrompt(true);
}

async function startRelay(port) {
  const server = new SmerpServer();
  await server.listen(port, "127.0.0.1");
  return {
    server,
    relay: {
      relayUrl: `http://127.0.0.1:${port}`,
      relayType: "archive",
      relayPkh: SmerpServer.PUBLIC_KEY_HEX,
    },
  };
}

async function startClient(name, identity, relays) {
  const client = new SmerpClient({ identity });

  for (const type of Object.values(EventTypes)) {
    client.on(type, (event) => {
      if (!log.enabled || (!log.verbose && NOISY.includes(type))) {
        return;
      }
      print(`[${name}] ${type} ${summarize(event)}`);
      if (log.verbose) {
        print(event);
      }
    });
  }

  await client.start();
  if (!names.has(client.publicKeyHex)) {
    names.set(client.publicKeyHex, name);
  }

  for (const { relay } of relays) {
    await client.relaysPut(relay);
  }

  return client;
}

// Resolves when client has stored an envelope with this uuid.
function received(client, uuid) {
  return new Promise((resolve) => {
    const off = client.on(EventTypes.ENVELOPE, ({ envelope }) => {
      if (envelope.uuid === uuid) {
        off();
        resolve(envelope);
      }
    });
    client.envelopesGet({ uuid }).then(([envelope]) => {
      if (envelope) {
        off();
        resolve(envelope);
      }
    });
  });
}

async function show(client) {
  const envelopes = await client.envelopesGet();
  console.table(envelopes.map((e) => ({
    dir: e.direction,
    peer: nameOf(e.publicKeyHex),
    text: text(e.plaintext),
    time: new Date(e.sentAt).toLocaleTimeString(),
    uuid: e.uuid.slice(0, 10) + "…",
  })));
}

// =====================================================
// Setup
// =====================================================

const relays = [];
for (const port of RELAY_PORTS) {
  relays.push(await startRelay(port));
}

const aliceIdentity = await PrivateIdentity.generate();

const alice = await startClient("alice", aliceIdentity, relays);
const alice2 = await startClient("alice2", aliceIdentity, relays);
const bob = await startClient("bob", await PrivateIdentity.generate(), relays);
const carol = await startClient("carol", await PrivateIdentity.generate(), relays);

const clients = { alice, alice2, bob, carol };

// =====================================================
// Seed
// =====================================================

const toBob = await alice.send(bob.publicKeyHex, "hello Bob - from alice");
const toCarol = await alice.send(carol.publicKeyHex, "hello Carol - from alice");

// Recipients and alice2 only learn about new envelopes on sync.
for (const client of [bob, carol, alice2]) {
  void client.sync();
}

await Promise.all([
  received(bob, toBob.uuid),
  received(carol, toCarol.uuid),
  received(alice2, toBob.uuid),
  received(alice2, toCarol.uuid),
]);

console.log();
for (const [name, client] of Object.entries(clients)) {
  console.log(`${name.padEnd(7)} ${client.publicKeyHex}`);
}
console.log(`relays  ${relays.map((r) => r.relay.relayUrl).join(", ")}`);
console.log(`\nSeeded. Try: await show(bob)   (see playground/repl.js for more)\n`);

// =====================================================
// REPL
// =====================================================

replServer = repl.start({ prompt: "smerp> " });

Object.assign(replServer.context, {
  ...clients,
  clients,
  relays,
  log,
  show,
  received,
  SmerpClient,
  PrivateIdentity,
  EventTypes,
  ContentTypes,
});

replServer.on("exit", async () => {
  log.enabled = false;
  await Promise.all(Object.values(clients).map((c) => c.stop()));
  await Promise.all(relays.map((r) => r.server.close().catch(() => {})));
  process.exit(0);
});
