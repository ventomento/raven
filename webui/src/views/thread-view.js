import { EventTypes, MAX_CONVERSATION_NAME } from "../../../index.js";
import { h, replaceChildren } from "../dom.js";
import { shortHex, peerLabel, formatTime } from "../format.js";
import { ComposeForm } from "../components/compose-form.js";
import { envelopeContent } from "../components/envelope-content.js";
import { avatar } from "../components/avatar.js";
import { openNotifyDialog } from "../components/notify-dialog.js";

const PAGE_SIZE = 50;

export class ThreadView {

  constructor({ client, shell, publicKeyHex }) {
    this.client = client;
    this.shell = shell;
    this.publicKeyHex = publicKeyHex;
    this.container = null;
    this.dialog = null;
    this.list = null;
    this.olderButton = null;
    this.head = null;
    this.shown = new Set();
    this.oldest = null;
    this.conversation = null;
    this.editing = false;
  }

  mount(container) {

    this.container = container;
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
    this.dialog?.close();
    this.dialog = null;
    this.container = null;
    this.list = null;
    this.olderButton = null;
    this.head = null;
  }

  async #loadConversation() {

    const [conversation] = await this.client.conversationsGet({ publicKeyHex: this.publicKeyHex });

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

    const rename = this.conversation && h("button", {
      class: "ghost",
      type: "button",
      onclick: () => this.#startRename(),
    }, "Rename");

    const notify = this.publicKeyHex !== this.client.publicKeyHex && h("button", {
      class: "ghost",
      type: "button",
      title: "Phone notifications",
      onclick: () => void this.#openNotify(),
    }, "Notify");

    replaceChildren(this.head, back, avatar(this.publicKeyHex, label), title, rename, notify);
  }

  async #openNotify() {

    const topic = await this.client.notifyTopic(this.publicKeyHex);

    if (!this.container) {
      return;
    }

    const name = this.conversation?.name;

    this.dialog?.close();
    this.dialog = openNotifyDialog({
      container: this.container,
      topic,
      ntfyUrl: this.client.ntfyUrl,
      label: name || "this peer",
      displayName: name || `raven ${shortHex(this.publicKeyHex)}`,
    });
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
          this.#stopRename();
        }
      },
    },
      input,
      h("button", { class: "primary", type: "submit" }, "Save"),
      h("button", { class: "ghost", type: "button", onclick: () => this.#stopRename() }, "Cancel")
    );
  }

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
