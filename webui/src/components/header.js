/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { h } from "../dom.js";
import { shortHex } from "../format.js";

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
          h("strong", {}, "smerp-client"),
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
