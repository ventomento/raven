// webui/src/views/conversations-view.js

import { EventTypes } from "../../../index.js";
import { h, replaceChildren, perFrame } from "../dom.js";
import { shortHex, formatTime } from "../format.js";

/**
 * Conversations, most recent first, with an unread badge per row.
 * Picking one opens its thread.
 */
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

  #row({ publicKeyHex, unreadCount = 0, lastMessageAt }) {

    return h("li", {},
      h("button", {
        class: `row${unreadCount > 0 ? " unread" : ""}`,
        type: "button",
        title: publicKeyHex,
        onclick: () => this.shell.openThread(publicKeyHex),
      },
        h("span", { class: "row-main" },
          h("span", { class: "eyebrow" }, "Peer"),
          h("span", { class: "mono" }, shortHex(publicKeyHex, 12, 6))
        ),
        h("span", { class: "row-side" },
          h("span", { class: "muted" }, formatTime(lastMessageAt)),
          unreadCount > 0 && h("span", { class: "badge" }, unreadCount)
        )
      )
    );
  }
}
