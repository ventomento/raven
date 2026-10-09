// webui/src/views/relays-view.js

import { EventTypes } from "../../../index.js";
import { h, replaceChildren, perFrame } from "../dom.js";
import { shortHex, formatTime, parsePublicKeyHex } from "../format.js";

/**
 * Configured relays with their sync health, a toggle to disable one, a
 * delete button, and a form to add a relay.
 */
export class RelaysView {

  constructor({ client }) {
    this.client = client;
    this.list = null;
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
        h("dd", { class: "mono", title: relay.relayPkh }, shortHex(relay.relayPkh))
      ),
      h("div", { class: `small ${failing ? "warn" : "muted"}` },
        relay.disabled
          ? "Disabled"
          : `Last sync ${formatTime(relay.lastSuccessAt)}` +
            (failing ? ` · ${relay.failureCount} failure${relay.failureCount > 1 ? "s" : ""} in a row` : "")
      ),
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

  #addForm() {

    const url = h("input", { type: "url", placeholder: "https://relay.example", required: true });
    const pkh = h("input", { class: "mono", type: "text", placeholder: "Relay public key (hex)", autocomplete: "off", required: true });
    const type = h("select", { "aria-label": "Relay type" },
      h("option", { value: "archive" }, "archive"),
      h("option", { value: "relay" }, "relay")
    );
    const status = h("div", { class: "form-status", role: "status" });

    const form = h("form", {
      class: "card",
      onsubmit: async (e) => {

        e.preventDefault();

        const relayPkh = parsePublicKeyHex(pkh.value);

        if (!relayPkh) {
          status.textContent = "Relay key must be a 64 character hex public key.";
          status.className = "form-status error";
          return;
        }

        try {
          await this.client.relaysPut({
            relayUrl: url.value.trim().replace(/\/+$/, ""),
            relayType: type.value,
            relayPkh,
          });
          url.value = "";
          pkh.value = "";
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
      pkh,
      type,
      h("div", { class: "form-row" },
        h("button", { class: "primary", type: "submit" }, "Add")
      ),
      status
    );

    return form;
  }
}
