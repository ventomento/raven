// webui/src/web-ui.js

import { SmerpClient, PrivateIdentity, IndexedDbStorage } from "../../index.js";
import { insist } from "../../smep/src/util/util.js";
import { h } from "./dom.js";
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
 */
export class WebUi {

  constructor({ privateKeyHex, root = document.body, storage = null }) {

    insist(privateKeyHex, "string");
    insist(root, HTMLElement);

    this.privateKeyHex = privateKeyHex;
    this.root = root;
    this.storage = storage;
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
    }
    catch (error) {
      this.stylesheet.remove();
      this.stylesheet = null;
      throw error;
    }

    this.client = client;
    this.shell = new AppShell({ client, root: this.root });
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
