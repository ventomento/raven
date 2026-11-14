/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { h, replaceChildren } from "../dom.js";
import { ComposeForm } from "../components/compose-form.js";

export class SendView {

  constructor({ client, shell, recipientPublicKeyHex = null }) {
    this.client = client;
    this.shell = shell;
    this.recipientPublicKeyHex = recipientPublicKeyHex;
  }

  mount(container) {

    const compose = new ComposeForm({
      client: this.client,
      onSent: (publicKeyHex, warning) => this.shell.openThread(publicKeyHex, { sendWarning: warning }),
    });

    replaceChildren(container,
      h("h2", {}, "New message"),
      h("section", { class: "card" }, compose.el)
    );

    if (this.recipientPublicKeyHex) {
      compose.recipientInput.value = this.recipientPublicKeyHex;
      compose.textInput.focus();
    }
  }

  onEvent() {}

  unmount() {}
}
