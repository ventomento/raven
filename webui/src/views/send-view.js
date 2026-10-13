// webui/src/views/send-view.js

import { h, replaceChildren } from "../dom.js";
import { ComposeForm } from "../components/compose-form.js";

/**
 * New message to any recipient. After sending, opens the thread with
 * that recipient.
 *
 * recipientPublicKeyHex: prefills the (still editable) recipient field.
 */
export class SendView {

  constructor({ client, shell, recipientPublicKeyHex = null }) {
    this.client = client;
    this.shell = shell;
    this.recipientPublicKeyHex = recipientPublicKeyHex;
  }

  mount(container) {

    const compose = new ComposeForm({
      client: this.client,
      onSent: (publicKeyHex) => this.shell.openThread(publicKeyHex),
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
