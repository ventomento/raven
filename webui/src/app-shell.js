// webui/src/app-shell.js

import { EventTypes } from "../../index.js";
import { h, replaceChildren, perFrame } from "./dom.js";
import { Header } from "./components/header.js";
import { TabBar } from "./components/tab-bar.js";
import { ConversationsView } from "./views/conversations-view.js";
import { ThreadView } from "./views/thread-view.js";
import { SendView } from "./views/send-view.js";
import { RelaysView } from "./views/relays-view.js";
import { IdentityView } from "./views/identity-view.js";

const TABS = [
  { id: "conversations", label: "Chats", View: ConversationsView },
  { id: "send", label: "Send", View: SendView },
  { id: "relays", label: "Relays", View: RelaysView },
  { id: "identity", label: "Identity", View: IdentityView },
];

/**
 * Page layout and navigation: header, tab bar and the active view.
 *
 * Holds the only client subscriptions of the UI and forwards every event
 * to the active view, so a view never subscribes itself and destroy()
 * is the one place listeners are removed.
 *
 * View contract: constructor({ client, shell, ... }), mount(container),
 * onEvent(event), unmount().
 */
export class AppShell {

  constructor({ client, identity, root, recipientPublicKeyHex = null }) {

    this.client = client;
    this.identity = identity;
    this.root = root;
    this.view = null;

    this.header = new Header({
      publicKeyHex: client.publicKeyHex,
      onSync: () => void client.sync(),
    });

    this.tabBar = new TabBar({
      tabs: TABS,
      onSelect: (id) => this.selectTab(id),
    });

    this.main = h("main", { class: "view" });

    this.updateUnread = perFrame(() => void this.#updateUnread());

    this.unsubscribes = Object.values(EventTypes).map(type =>
      client.on(type, (event) => this.#onEvent(event))
    );

    root.classList.add("webui");
    replaceChildren(root,
      h("div", { class: "top" }, this.header.el, this.tabBar.el),
      this.main
    );

    if (recipientPublicKeyHex) {
      this.selectTab("send", { recipientPublicKeyHex });
    }
    else {
      this.selectTab("conversations");
    }

    this.updateUnread();
  }

  // options: extra constructor options for the view.
  selectTab(id, options = {}) {
    const { View } = TABS.find(tab => tab.id === id);
    this.tabBar.select(id);
    this.#show(new View({ ...options, client: this.client, identity: this.identity, shell: this }));
  }

  openThread(publicKeyHex) {
    this.tabBar.select("conversations");
    this.#show(new ThreadView({ client: this.client, shell: this, publicKeyHex }));
  }

  closeThread() {
    this.selectTab("conversations");
  }

  destroy() {

    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }

    this.view?.unmount();
    this.view = null;

    this.root.replaceChildren();
    this.root.classList.remove("webui");
  }

  #show(view) {
    this.view?.unmount();
    this.view = view;
    this.main.scrollTop = 0;
    window.scrollTo(0, 0);
    view.mount(this.main);
  }

  #onEvent(event) {

    switch (event.type) {
      case EventTypes.SYNC:
        this.header.setSyncing(event.phase === "start");
        break;
      case EventTypes.ERROR:
        this.header.setError(
          event.relayUrl ? `${event.relayUrl}: ${event.error?.message}` : event.error?.message
        );
        break;
      case EventTypes.CONVERSATION:
        this.updateUnread();
        break;
    }

    this.view?.onEvent(event);
  }

  async #updateUnread() {

    if (this.client.status !== "running") {
      return;
    }

    const conversations = await this.client.conversationsGet();
    const unread = conversations.filter(c => c.unreadCount > 0).length;

    this.tabBar.setBadge("conversations", unread);
  }
}
