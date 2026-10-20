import { SmerpClient, PrivateIdentity, IndexedDbStorage } from "../../index.js";
import { insist } from "../../smep/src/util/util.js";
import { h } from "./dom.js";
import { parsePublicKeyHex } from "./format.js";
import { AppShell } from "./app-shell.js";
import { browserSupport, UnsupportedBrowserError } from "./browser-support.js";
import { WEBUI_CSS } from "./styles/webui.css.js";

export class WebUi {

  constructor({
    privateKeyHex,
    root = document.body,
    storage = null,
    recipientPublicKeyHex = null,
    relays = [],
    debug = false,
  }) {

    insist(privateKeyHex, "string");
    insist(root, HTMLElement);
    insist(relays, Array);

    this.privateKeyHex = privateKeyHex;
    this.root = root;
    this.storage = storage;
    this.recipientPublicKeyHex = recipientPublicKeyHex === null ? null : parseKey(recipientPublicKeyHex, "recipientPublicKeyHex");
    this.relays = relays.map(normalizeRelay);
    this.debug = debug;
    this.client = null;
    this.shell = null;
    this.stylesheet = null;
  }

  async start() {

    if (this.client) {
      return;
    }

    const support = await browserSupport({ indexedDb: !this.storage });

    if (!support.ok) {
      throw new UnsupportedBrowserError(support.reason);
    }

    const identity = await PrivateIdentity.fromPrivateKeyHex(this.privateKeyHex);

    const client = new SmerpClient({
      identity,
      storage: this.storage ?? new IndexedDbStorage(identity.publicKeyHex),
      debug: this.debug,
    });

    try {
      await client.start();
      await this.#seedRelays(client);
    }
    catch (error) {
      await client.stop();
      throw error;
    }

    this.client = client;
    this.stylesheet = h("style", {}, WEBUI_CSS);
    document.head.append(this.stylesheet);
    this.shell = new AppShell({
      client,
      identity,
      root: this.root,
      recipientPublicKeyHex: this.recipientPublicKeyHex,
    });
  }

  async stop() {

    if (!this.client) {
      return;
    }

    this.shell.destroy();
    await this.client.stop();

    this.stylesheet?.remove();

    this.shell = null;
    this.client = null;
    this.stylesheet = null;
  }

  async #seedRelays(client) {

    const stored = new Set((await client.relaysGet()).map(relay => relay.relayUrl));

    for (const relay of this.relays) {
      if (!stored.has(relay.relayUrl)) {
        await client.relaysPut(relay);
      }
    }
  }
}

function parseKey(value, name) {

  insist(value, "string");

  const hex = parsePublicKeyHex(value);

  if (!hex) {
    throw new Error(`${name} must be a 64 character hex public key`);
  }

  return hex;
}

function normalizeRelay({ relayUrl, relayType = "relay", relayPkh, relayToken }) {

  insist(relayUrl, "string");
  insist(relayType, "string");

  return {
    relayUrl: relayUrl.trim().replace(/\/+$/, ""),
    relayType,
    ...(relayPkh != null && { relayPkh: parseKey(relayPkh, "relayPkh") }),
    ...(relayToken != null && { relayToken: insist(relayToken, "string") }),
  };
}
