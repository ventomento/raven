// webui/src/views/identity-view.js

import { h, replaceChildren } from "../dom.js";

/**
 * The client's own keys. The private key stays hidden until revealed.
 */
export class IdentityView {

  // identity: the PrivateIdentity, from WebUi; the client does not expose it.
  constructor({ client, identity }) {
    this.client = client;
    this.identity = identity;
  }

  mount(container) {

    const publicKeyHex = this.client.publicKeyHex;

    const privateValue = h("code", { class: "key" }, "••••••••••••••••");
    let privateKeyHex = null;

    const revealButton = h("button", {
      class: "ghost",
      type: "button",
      onclick: async () => {
        privateKeyHex ??= await this.identity.exportPrivateHex();
        const reveal = revealButton.textContent === "Reveal";
        privateValue.textContent = reveal ? privateKeyHex : "••••••••••••••••";
        revealButton.textContent = reveal ? "Hide" : "Reveal";
      },
    }, "Reveal");

    replaceChildren(container,
      h("h2", {}, "Identity"),
      h("section", { class: "card" },
        h("div", { class: "label" }, "Public key"),
        h("p", { class: "muted small" }, "Share this so others can message you."),
        h("code", { class: "key" }, publicKeyHex),
        h("div", { class: "form-row" },
          copyButton(() => publicKeyHex)
        )
      ),
      h("section", { class: "card" },
        h("div", { class: "label" }, "Private key"),
        h("p", { class: "muted small" }, "Anyone with this key can read your messages and send as you. Keep it secret."),
        privateValue,
        h("div", { class: "form-row" },
          revealButton,
          copyButton(() => this.identity.exportPrivateHex())
        )
      )
    );
  }

  onEvent() {}

  unmount() {}
}

function copyButton(getText) {

  const button = h("button", {
    class: "ghost",
    type: "button",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(await getText());
        button.textContent = "Copied";
      }
      catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    },
  }, "Copy");

  return button;
}
