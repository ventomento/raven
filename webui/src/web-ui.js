// webui/src/web-ui.js

import { SmerpClient, PrivateIdentity, IndexedDbStorage } from "../../index.js";
import { insist } from "../../smep/src/util/util.js";
import { h } from "./dom.js";
import { parsePublicKeyHex } from "./format.js";
import { AppShell } from "./app-shell.js";

const STYLESHEET_URL = new URL("./styles/webui.css", import.meta.url);

/**
 * Browser UI for a SmerpClient. Takes over root (the whole body by
 * default):
 *
 *   const ui = new WebUi({ privateKeyHex });
 *   await ui.start();
 *
 * storage defaults to an IndexedDB database per identity, so history
 * survives reloads. The private key itself is never stored.
 *
 * recipientPublicKeyHex: opens the Send view with this recipient filled
 * in instead of the chat list.
 * relays: [{ relayUrl, relayType, relayPkh?, relayToken? }] added to storage on start
 * unless a relay with that relayUrl is already stored. Stored relays are
 * left untouched, so the user's edits (e.g. disabling one) survive.
 * relayPkh is optional: the client learns it from the relay.
 */
export class WebUi {

  constructor({
    privateKeyHex,
    root = document.body,
    storage = null,
    recipientPublicKeyHex = null,
    relays = [],
  }) {

    insist(privateKeyHex, "string");
    insist(root, HTMLElement);
    insist(relays, Array);

    this.privateKeyHex = privateKeyHex;
    this.root = root;
    this.storage = storage;
    this.recipientPublicKeyHex = recipientPublicKeyHex === null ? null : parseKey(recipientPublicKeyHex, "recipientPublicKeyHex");
    this.relays = relays.map(normalizeRelay);
    this.client = null;
    this.shell = null;
    this.stylesheet = null;
  }

  async start() {

    if (this.client) {
      return;
    }

    const identity = await PrivateIdentity.fromPrivateKeyHex(this.privateKeyHex);

    const client = new SmerpClient({
      identity,
      storage: this.storage ?? new IndexedDbStorage(identity.publicKeyHex),
    });

    try {
      await Promise.all([client.start(), this.#loadStylesheet()]);
      await this.#seedRelays(client);
    }
    catch (error) {
      await client.stop();
      this.stylesheet.remove();
      this.stylesheet = null;
      throw error;
    }

    this.client = client;
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

    this.stylesheet.remove();

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

  // Resolves once loaded (or failed) so the first render is styled.
  #loadStylesheet() {

    return new Promise(resolve => {
      this.stylesheet = h("link", {
        rel: "stylesheet",
        href: STYLESHEET_URL.href,
        onload: resolve,
        onerror: resolve,
      });
      document.head.append(this.stylesheet);
    });
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

// Same normalization as the Add relay form, so a seeded relay and one
// typed in by hand get the same relayUrl key.
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
