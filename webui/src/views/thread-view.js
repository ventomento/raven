// webui/src/views/thread-view.js

import { EventTypes, MAX_CONVERSATION_NAME } from "../../../index.js";
import { h, replaceChildren } from "../dom.js";
import { shortHex, peerLabel, formatTime } from "../format.js";
import { ComposeForm } from "../components/compose-form.js";
import { envelopeContent } from "../components/envelope-content.js";

const PAGE_SIZE = 50;

/**
 * One conversation: reply form on top, then messages newest first, with
 * older pages loaded on demand. Keeps the conversation marked read while
 * it is open. The header shows the conversation's name and renames it in
 * place.
 */
export class ThreadView {

  constructor({ client, shell, publicKeyHex }) {
    this.client = client;
    this.shell = shell;
    this.publicKeyHex = publicKeyHex;
    this.list = null;
    this.olderButton = null;
    this.head = null;
    this.shown = new Set();   // envelope hashes in the list
    this.oldest = null;       // last envelope of the last page loaded
    this.conversation = null; // null until stored (a new thread has none yet)
    this.editing = false;
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

    this.head = h("div", { class: "thread-head" });
    this.#renderHead();

    replaceChildren(container,
      this.head,
      compose.el,
      this.list,
      this.olderButton
    );

    void this.#loadConversation();
    void this.#loadPage();
    void this.#markRead();
  }

  onEvent(event) {

    if (event.type === EventTypes.ENVELOPE && event.envelope.publicKeyHex === this.publicKeyHex) {
      this.#prepend(event.envelope);
    }

    if (event.type === EventTypes.CONVERSATION && event.conversation.publicKeyHex === this.publicKeyHex) {

      this.#showConversation(event.conversation);

      if (event.conversation.unreadCount > 0) {
        void this.#markRead(event.conversation);
      }
    }
  }

  unmount() {
    this.list = null;
    this.olderButton = null;
    this.head = null;
  }

  async #loadConversation() {

    const [conversation] = await this.client.conversationsGet({ publicKeyHex: this.publicKeyHex });

    // An event may have delivered a newer one meanwhile.
    if (conversation && !this.conversation) {
      this.#showConversation(conversation);
    }
  }

  #showConversation(conversation) {

    if (!this.head) {
      return;
    }

    this.conversation = conversation;

    if (!this.editing) {
      this.#renderHead();
    }

    for (const label of this.list.querySelectorAll(".peer-label")) {
      label.textContent = this.#messageAuthor();
    }
  }

  // ---------------------------------------------- header

  #renderHead() {

    const back = h("button", { class: "ghost", type: "button", onclick: () => this.shell.closeThread() }, "← Back");

    if (this.editing) {
      replaceChildren(this.head, back, this.#renameForm());
      return;
    }

    const hex = shortHex(this.publicKeyHex, 12, 6);
    const label = this.conversation
      ? peerLabel(this.conversation, this.client.publicKeyHex)
      : null;

    const title = label
      ? h("span", { class: "thread-title", title: this.publicKeyHex },
          h("span", { class: "thread-name" }, label),
          h("span", { class: "mono muted small" }, hex)
        )
      : h("span", { class: "thread-title", title: this.publicKeyHex },
          h("span", { class: "eyebrow" }, "Peer"),
          h("span", { class: "mono" }, hex)
        );

    // Only a stored conversation can be named.
    const rename = this.conversation && h("button", {
      class: "ghost",
      type: "button",
      onclick: () => this.#startRename(),
    }, "Rename");

    replaceChildren(this.head, back, title, rename);
  }

  #startRename() {
    this.editing = true;
    this.#renderHead();
    const input = this.head.querySelector("input");
    input.focus();
    input.select();
  }

  #stopRename() {
    this.editing = false;
    if (this.head) {
      this.#renderHead();
    }
  }

  #renameForm() {

    const input = h("input", {
      type: "text",
      value: this.conversation?.name ?? "",
      maxLength: MAX_CONVERSATION_NAME,
      placeholder: "Name (empty removes it)",
      "aria-label": "Conversation name",
      onkeydown: (event) => {
        if (event.key === "Escape") {
          this.#stopRename();
        }
      },
    });

    return h("form", {
      class: "rename",
      onsubmit: async (event) => {
        event.preventDefault();
        try {
          await this.client.renameConversation(this.publicKeyHex, input.value);
        }
        finally {
          // The CONVERSATION event already brought the new name.
          this.#stopRename();
        }
      },
    },
      input,
      h("button", { class: "primary", type: "submit" }, "Save"),
      h("button", { class: "ghost", type: "button", onclick: () => this.#stopRename() }, "Cancel")
    );
  }

  // ---------------------------------------------- messages

  // What inbound messages are labelled with: the peer's name, else "Peer".
  #messageAuthor() {
    return this.conversation?.name || "Peer";
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
        outbound ? "You" : h("span", { class: "peer-label" }, this.#messageAuthor()),
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
