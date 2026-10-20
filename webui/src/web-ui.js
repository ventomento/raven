import { SmerpClient, PrivateIdentity, IndexedDbStorage } from "../../index.js";
import { insist } from "../../smep/src/util/util.js";
import { h, replaceChildren } from "./dom.js";
import { parsePublicKeyHex } from "./format.js";
import { AppShell } from "./app-shell.js";
import { browserSupport, UnsupportedBrowserError } from "./browser-support.js";
import { deleteAllDatabases } from "./browser-data.js";
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
    this.databaseName = null;
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

    const storage = this.storage ?? new IndexedDbStorage(identity.publicKeyHex);

    const client = new SmerpClient({
      identity,
      storage,
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
    this.databaseName = storage.databaseName ?? null;
    this.#removeNotice();
    this.stylesheet = h("style", {}, WEBUI_CSS);
    document.head.append(this.stylesheet);
    this.shell = new AppShell({
      client,
      identity,
      root: this.root,
      recipientPublicKeyHex: this.recipientPublicKeyHex,
      deleteBrowserData: () => this.deleteBrowserData(),
    });
  }

  // Stops the client (closing its database, so deleting it is not blocked),
  // deletes every IndexedDB database of this origin and leaves a notice in
  // place of the UI. stop() removes the notice.
  async deleteBrowserData() {

    if (!this.client) {
      return;
    }

    this.shell.destroy();
    this.shell = null;

    await this.client.stop();
    this.client = null;

    const result = await deleteAllDatabases({
      fallbackNames: this.databaseName ? [this.databaseName] : [],
    });

    this.root.classList.add("webui");
    replaceChildren(this.root, deletedNotice(result));
  }

  async stop() {

    if (!this.client) {
      this.#removeNotice();
      return;
    }

    this.shell.destroy();
    await this.client.stop();

    this.stylesheet?.remove();

    this.shell = null;
    this.client = null;
    this.stylesheet = null;
  }

  #removeNotice() {

    if (!this.stylesheet) {
      return;
    }

    this.root.replaceChildren();
    this.root.classList.remove("webui");
    this.stylesheet.remove();
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

function deletedNotice({ listed, deleted, blocked, failed }) {

  const lines = [
    listed
      ? `Deleted ${deleted.length} IndexedDB ${deleted.length === 1 ? "database" : "databases"} of this site.`
      : "This browser can't list its databases, so only this identity's data was deleted. " +
        "Clear the site data in the browser settings to remove the rest.",
  ];

  if (blocked.length > 0) {
    lines.push(`${blocked.length} still open in another tab will be deleted when that tab is closed.`);
  }

  if (failed.length > 0) {
    lines.push(`${failed.length} could not be deleted: ${failed.join(", ")}. ` +
      "Clear the site data in the browser settings to remove them.");
  }

  return h("main", { class: "view" },
    h("section", { class: "card" },
      h("div", { class: "label" }, "Local data deleted"),
      ...lines.map(line => h("p", { class: "muted small" }, line)),
      h("p", { class: "muted small" }, "Reload the page to start again.")
    )
  );
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
