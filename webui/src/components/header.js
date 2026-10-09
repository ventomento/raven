// webui/src/components/header.js

import { h } from "../dom.js";
import { shortHex } from "../format.js";

/**
 * Top bar: who we are, whether a sync is running, the last background
 * error, and a manual "Sync" button.
 */
export class Header {

  constructor({ publicKeyHex, onSync }) {

    this.syncButton = h("button", {
      class: "ghost",
      type: "button",
      onclick: onSync,
    }, "Sync");

    this.errorLine = h("div", {
      class: "error-line",
      hidden: true,
      onclick: () => this.setError(null),
      title: "Dismiss",
    });

    this.el = h("header", { class: "header" },
      h("div", { class: "header-row" },
        h("div", { class: "brand" },
          h("strong", {}, "smerp"),
          h("span", { class: "mono muted", title: publicKeyHex }, shortHex(publicKeyHex))
        ),
        this.syncButton
      ),
      this.errorLine
    );
  }

  setSyncing(syncing) {
    this.syncButton.classList.toggle("syncing", syncing);
    this.syncButton.textContent = syncing ? "Syncing…" : "Sync";
  }

  setError(message) {
    this.errorLine.textContent = message ?? "";
    this.errorLine.hidden = !message;
  }
}
