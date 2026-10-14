import repl from "node:repl";
import { SmerpClient, PrivateIdentity, EventTypes, ContentTypes } from "raven";
import { SmerpServer } from "raven/testing";

const RELAY_PORTS = [8001, 8002];

const log = { enabled: true, verbose: false };

const NOISY = [EventTypes.SYNC, EventTypes.RELAY];
const names = new Map();

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

function received(client, hash) {
  return new Promise((resolve) => {
    const off = client.on(EventTypes.ENVELOPE, ({ envelope }) => {
      if (envelope.hash === hash) {
        off();
        resolve(envelope);
      }
    });
    client.envelopesGet({ hash }).then(([envelope]) => {
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
    hash: e.hash.slice(0, 10) + "…",
  })));
}

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

const toBob = await alice.send(bob.publicKeyHex, "hello Bob - from alice");
const toCarol = await alice.send(carol.publicKeyHex, "hello Carol - from alice");

for (const client of [bob, carol, alice2]) {
  void client.sync();
}

await Promise.all([
  received(bob, toBob.hash),
  received(carol, toCarol.hash),
  received(alice2, toBob.hash),
  received(alice2, toCarol.hash),
]);

console.log();
for (const [name, client] of Object.entries(clients)) {
  console.log(`${name.padEnd(7)} ${client.publicKeyHex}`);
}
console.log(`relays  ${relays.map((r) => r.relay.relayUrl).join(", ")}`);
console.log(`\nSeeded. Try: await show(bob)   (see playground/repl.js for more)\n`);

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
