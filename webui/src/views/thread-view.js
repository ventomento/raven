// webui/src/views/thread-view.js

import { EventTypes } from "../../../index.js";
import { h, replaceChildren } from "../dom.js";
import { shortHex, formatTime } from "../format.js";
import { ComposeForm } from "../components/compose-form.js";
import { envelopeContent } from "../components/envelope-content.js";

const PAGE_SIZE = 50;

/**
 * One conversation: reply form on top, then messages newest first, with
 * older pages loaded on demand. Keeps the conversation marked read while
 * it is open.
 */
export class ThreadView {

  constructor({ client, shell, publicKeyHex }) {
    this.client = client;
    this.shell = shell;
    this.publicKeyHex = publicKeyHex;
    this.list = null;
    this.olderButton = null;
    this.shown = new Set();   // envelope hashes in the list
    this.oldest = null;       // last envelope of the last page loaded
  }

  mount(container) {

    this.list = h("ul", { class: "messages" });

    this.olderButton = h("button", {
      class: "ghost wide",
      type: "button",
      hidden: true,
      onclick: () => void this.#loadPage(),
    }, "Load older");

    const compose = new ComposeForm({
      client: this.client,
      recipientPublicKeyHex: this.publicKeyHex,
    });

    replaceChildren(container,
      h("div", { class: "thread-head" },
        h("button", { class: "ghost", type: "button", onclick: () => this.shell.closeThread() }, "← Back"),
        h("span", { class: "thread-title", title: this.publicKeyHex },
          h("span", { class: "eyebrow" }, "Peer"),
          h("span", { class: "mono" }, shortHex(this.publicKeyHex, 12, 6))
        )
      ),
      compose.el,
      this.list,
      this.olderButton
    );

    void this.#loadPage();
    void this.#markRead();
  }

  onEvent(event) {

    if (event.type === EventTypes.ENVELOPE && event.envelope.publicKeyHex === this.publicKeyHex) {
      this.#prepend(event.envelope);
    }

    if (
      event.type === EventTypes.CONVERSATION &&
      event.conversation.publicKeyHex === this.publicKeyHex &&
      event.conversation.unreadCount > 0
    ) {
      void this.#markRead(event.conversation);
    }
  }

  unmount() {
    this.list = null;
    this.olderButton = null;
  }

  async #loadPage() {

    const position = this.oldest
      ? { beforeSentAt: this.oldest.sentAt, beforeReceivedAt: this.oldest.receivedAt }
      : {};

    const envelopes = await this.client.envelopesGet({
      publicKeyHex: this.publicKeyHex,
      ...position,
      limit: PAGE_SIZE,
    });

    if (!this.list) {
      return;
    }

    if (envelopes.length > 0) {
      this.oldest = envelopes.at(-1);
    }

    // Storage returns newest first, which is display order.
    for (const envelope of envelopes) {
      if (!this.shown.has(envelope.hash)) {
        this.shown.add(envelope.hash);
        this.list.append(this.#item(envelope));
      }
    }

    this.olderButton.hidden = envelopes.length < PAGE_SIZE;

    if (this.shown.size === 0) {
      this.list.append(h("li", { class: "empty" }, "No messages yet."));
    }
  }

  #prepend(envelope) {

    if (!this.list || this.shown.has(envelope.hash)) {
      return;
    }

    this.shown.add(envelope.hash);
    this.list.querySelector(":scope > .empty")?.remove();
    this.list.prepend(this.#item(envelope));
  }

  #item(envelope) {

    const outbound = envelope.direction === "outbound";

    return h("li", { class: `message ${outbound ? "outbound" : "inbound"}` },
      h("div", { class: "message-meta muted" },
        outbound ? "You" : "Peer",
        " · ",
        formatTime(envelope.sentAt)
      ),
      envelopeContent(envelope)
    );
  }

  async #markRead(conversation) {

    if (conversation && conversation.unreadCount === 0) {
      return;
    }

    await this.client.markRead(this.publicKeyHex);
  }
}
