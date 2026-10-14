import { h, replaceChildren, downloadBytes } from "../dom.js";

export class IdentityView {
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
        h("p", { class: "muted small" },
          "This is your address. Share it with anyone you want to hear from: " +
          "anyone who has it can send you messages."),
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
          h("button", {
            class: "ghost",
            type: "button",
            onclick: () => this.downloadPrivateKey(publicKeyHex),
          }, "Download")
        )
      ),
      h("section", { class: "card" },
        h("div", { class: "label" }, "About your key"),
        h("p", { class: "muted small" },
          h("strong", {}, "Back it up."),
          " Your private key is your account. There is no password reset or " +
          "recovery: if you lose it, nobody can restore your inbox. Saving it " +
          "and keeping it safe on your devices, backups and cloud storage is up to you."),
        h("p", { class: "muted small" },
          h("strong", {}, "Use it with any client."),
          " The key isn't tied to this app or website. Any client that " +
          "implements the smerp protocol can open your inbox with it."),
        h("p", { class: "muted small" },
          h("strong", {}, "Inboxes can differ."),
          " Relays deliver on a best-effort basis and may delete messages after " +
          "a retention period. Each client keeps its own copy of what it has " +
          "downloaded, so a client set up later or on another device only gets " +
          "what the relays still hold, and older messages may be missing there. " +
          "Messages shown here are stored only in this browser; clearing its " +
          "site data deletes them.")
      )
    );
  }

  async downloadPrivateKey(publicKeyHex) {

    const privateKeyHex = await this.identity.exportPrivateHex();

    downloadBytes(
      `${privateKeyHex}\n`,
      `smerp-private-key-${publicKeyHex.slice(0, 8)}.txt`,
      "application/octet-stream"
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
