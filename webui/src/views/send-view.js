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
