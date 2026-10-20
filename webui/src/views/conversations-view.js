import { EventTypes } from "../../../index.js";
import { h, replaceChildren, perFrame } from "../dom.js";
import { shortHex, peerLabel, formatTime } from "../format.js";
import { avatar } from "../components/avatar.js";

export class ConversationsView {

  constructor({ client, shell }) {
    this.client = client;
    this.shell = shell;
    this.list = null;
    this.scheduleRender = perFrame(() => void this.#render());
  }

  mount(container) {
    this.list = h("ul", { class: "list" });
    replaceChildren(container, this.list);
    void this.#render();
  }

  onEvent(event) {
    if (event.type === EventTypes.CONVERSATION) {
      this.scheduleRender();
    }
  }

  unmount() {
    this.list = null;
  }

  async #render() {

    if (!this.list) {
      return;
    }

    const conversations = await this.client.conversationsGet();

    if (!this.list) {
      return;
    }

    if (conversations.length === 0) {
      replaceChildren(this.list,
        h("li", { class: "empty" }, "No conversations yet. Start one from the Send tab.")
      );
      return;
    }

    replaceChildren(this.list, conversations.map(c => this.#row(c)));
  }

  #row(conversation) {

    const { publicKeyHex, unreadCount = 0, lastMessageAt } = conversation;
    const label = peerLabel(conversation, this.client.publicKeyHex);
    const hex = shortHex(publicKeyHex, 12, 6);

    return h("li", {},
      h("button", {
        class: `row${unreadCount > 0 ? " unread" : ""}`,
        type: "button",
        title: publicKeyHex,
        onclick: () => this.shell.openThread(publicKeyHex),
      },
        avatar(publicKeyHex, label),
        label
          ? h("span", { class: "row-main" },
              h("span", { class: "row-primary" }, label),
              h("span", { class: "mono muted small" }, hex)
            )
          : h("span", { class: "row-main" },
              h("span", { class: "eyebrow" }, "Peer"),
              h("span", { class: "mono row-primary" }, hex)
            ),
        h("span", { class: "row-side" },
          h("span", { class: "muted" }, formatTime(lastMessageAt)),
          unreadCount > 0 && h("span", { class: "badge" }, unreadCount)
        )
      )
    );
  }
}
