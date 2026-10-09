// webui/src/views/send-view.js

import { h, replaceChildren } from "../dom.js";
import { ComposeForm } from "../components/compose-form.js";

/**
 * New message to any recipient. After sending, opens the thread with
 * that recipient.
 */
export class SendView {

  constructor({ client, shell }) {
    this.client = client;
    this.shell = shell;
  }

  mount(container) {

    const compose = new ComposeForm({
      client: this.client,
      onSent: (publicKeyHex) => this.shell.openThread(publicKeyHex),
    });

    replaceChildren(container,
      h("h2", {}, "New message"),
      compose.el
    );
  }

  onEvent() {}

  unmount() {}
}
