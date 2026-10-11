// webui/src/views/relays-view.js

import { EventTypes } from "../../../index.js";
import { h, replaceChildren, perFrame } from "../dom.js";
import { shortHex, formatTime } from "../format.js";

/**
 * Configured relays with their sync health, a toggle to disable one, a
 * delete button, an access token editor, and a form to add a relay.
 */
export class RelaysView {

  constructor({ client }) {
    this.client = client;
    this.list = null;
    // relayUrl -> token editor. Reused across renders so a sync event
    // does not wipe what the user is typing.
    this.tokenEditors = new Map();
    this.scheduleRender = perFrame(() => void this.#render());
  }

  mount(container) {
    this.list = h("ul", { class: "list" });
    replaceChildren(container,
      h("h2", {}, "Relays"),
      this.list,
      this.#addForm()
    );
    void this.#render();
  }

  onEvent(event) {
    if (event.type === EventTypes.RELAY) {
      this.scheduleRender();
    }
  }

  unmount() {
    this.list = null;
    this.tokenEditors.clear();
  }

  async #render() {

    if (!this.list) {
      return;
    }

    const relays = await this.client.relaysGet();

    if (!this.list) {
      return;
    }

    if (relays.length === 0) {
      replaceChildren(this.list,
        h("li", { class: "empty" }, "No relays. Add one below to send and receive.")
      );
      return;
    }

    relays.sort((a, b) => a.relayUrl.localeCompare(b.relayUrl));

    const urls = new Set(relays.map(relay => relay.relayUrl));

    for (const relayUrl of this.tokenEditors.keys()) {
      if (!urls.has(relayUrl)) {
        this.tokenEditors.delete(relayUrl);
      }
    }

    replaceChildren(this.list, relays.map(relay => this.#row(relay)));
  }

  #row(relay) {

    const failing = relay.failureCount > 0;

    return h("li", { class: `card relay${relay.disabled ? " disabled" : ""}` },
      h("div", { class: "relay-url" }, relay.relayUrl),
      h("dl", { class: "relay-meta small" },
        h("dt", { class: "muted" }, "Type"),
        h("dd", {}, relay.relayType),
        h("dt", { class: "muted" }, "Public key"),
        relay.relayPkh
          ? h("dd", { class: "mono", title: relay.relayPkh }, shortHex(relay.relayPkh))
          : h("dd", { class: "muted" }, "Learned on first sync"),
        h("dt", { class: "muted" }, "Access token"),
        relay.relayToken
          ? h("dd", { class: "mono" }, maskToken(relay.relayToken))
          : h("dd", { class: "muted" }, "None")
      ),
      h("div", { class: `small ${failing ? "warn" : "muted"}` },
        relay.disabled
          ? "Disabled"
          : `Last sync ${formatTime(relay.lastSuccessAt)}` +
            (failing ? ` · ${relay.failureCount} failure${relay.failureCount > 1 ? "s" : ""} in a row` : "")
      ),
      // May quote the relay: rendered as text only.
      failing && relay.lastFailureReason
        ? h("div", { class: "small warn" }, relay.lastFailureReason)
        : null,
      this.#tokenEditor(relay),
      h("div", { class: "form-row" },
        h("button", {
          class: "ghost",
          type: "button",
          onclick: () => void this.client.relaysPut({ ...relay, disabled: !relay.disabled }),
        }, relay.disabled ? "Enable" : "Disable"),
        h("button", {
          class: "ghost danger",
          type: "button",
          onclick: () => void this.client.relaysDelete({ relayUrl: relay.relayUrl }),
        }, "Remove")
      )
    );
  }

  // Collapsible password field to set, change or clear the token.
  #tokenEditor(relay) {

    const existing = this.tokenEditors.get(relay.relayUrl);

    if (existing) {
      return existing;
    }

    const input = tokenInput();

    const save = async (relayToken) => {

      const [current] = await this.client.relaysGet({ relayUrl: relay.relayUrl });

      if (!current) {
        return;
      }

      await this.client.relaysPut({ ...current, relayToken });
      input.value = "";
      editor.open = false;
    };

    const editor = h("details", { class: "token-editor small" },
      h("summary", {}, "Access token"),
      h("form", {
        onsubmit: (e) => {
          e.preventDefault();
          void save(input.value.trim() || null);
        },
      },
        input,
        h("div", { class: "form-row" },
          h("button", { class: "primary", type: "submit" }, "Save"),
          h("button", { class: "ghost danger", type: "button", onclick: () => void save(null) }, "Clear")
        )
      )
    );

    this.tokenEditors.set(relay.relayUrl, editor);

    return editor;
  }

  #addForm() {

    const url = h("input", { type: "url", placeholder: "https://relay.example", required: true });
    const token = tokenInput("Access token (optional)");
    const type = h("select", { "aria-label": "Relay type" },
      h("option", { value: "archive" }, "archive"),
      h("option", { value: "relay" }, "relay")
    );
    const status = h("div", { class: "form-status", role: "status" });

    const form = h("form", {
      class: "card",
      onsubmit: async (e) => {

        e.preventDefault();

        try {
          await this.client.relaysPut({
            relayUrl: url.value.trim().replace(/\/+$/, ""),
            relayType: type.value,
            relayToken: token.value.trim() || null,
          });
          url.value = "";
          token.value = "";
          status.textContent = "";
        }
        catch (error) {
          status.textContent = error.message;
          status.className = "form-status error";
        }
      },
    },
      h("div", { class: "label" }, "Add relay"),
      url,
      type,
      token,
      h("div", { class: "form-row" },
        h("button", { class: "primary", type: "submit" }, "Add")
      ),
      status
    );

    return form;
  }
}

function tokenInput(placeholder = "Access token") {
  return h("input", { type: "password", placeholder, autocomplete: "off" });
}

// Never show a token in full.
function maskToken(token) {
  return `••••${token.slice(-4)}`;
}
