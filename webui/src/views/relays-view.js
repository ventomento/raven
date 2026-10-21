import { EventTypes } from "../../../index.js";
import { h, replaceChildren, perFrame } from "../dom.js";
import { formatTime, shortHex } from "../format.js";
import { relayHealth } from "../relay-health.js";

export class RelaysView {

  constructor({ client }) {
    this.client = client;
    this.list = null;
    this.tokenEditors = new Map();
    this.openDiagnostics = new Set();
    this.scheduleRender = perFrame(() => void this.#render());
  }

  mount(container) {
    this.list = h("ul", { class: "list" });
    replaceChildren(container,
      h("h2", {}, "Relays"),
      this.list,
      this.#addForm(),
      aboutRelays()
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

    for (const relayUrl of this.openDiagnostics) {
      if (!urls.has(relayUrl)) {
        this.openDiagnostics.delete(relayUrl);
      }
    }

    replaceChildren(this.list, relays.map(relay => this.#row(relay)));
  }

  #row(relay) {

    const health = relayHealth(relay);
    const failing = health.state === "failing";

    return h("li", { class: `card relay${relay.disabled ? " disabled" : ""}` },
      h("div", { class: "relay-head" },
        h("div", { class: "relay-url" }, relay.relayUrl),
        h("span", { class: `pill ${health.state}` }, health.label)
      ),
      h("dl", { class: "relay-meta small" },
        h("dt", { class: "muted" }, "Type"),
        h("dd", {}, relay.relayType),
        h("dt", { class: "muted" }, "Access token"),
        relay.relayToken
          ? h("dd", { class: "mono" }, maskToken(relay.relayToken))
          : h("dd", { class: "muted" }, "None")
      ),
      !relay.disabled && h("div", { class: `small ${failing ? "warn" : "muted"}` },
        `Last sync ${formatTime(relay.lastSuccessAt)}` +
        (failing ? ` · ${relay.failureCount} failure${relay.failureCount > 1 ? "s" : ""} in a row` : "") +
        (health.retryAt ? ` · next try after ${formatTime(health.retryAt)}` : "")
      ),
      failing && relay.lastFailureReason
        ? h("div", { class: "small warn" }, relay.lastFailureReason)
        : null,
      this.#diagnostics(relay, health),
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

  // Everything the session stores about the relay, for judging its health.
  // Collapsed by default; stays open across re-renders.
  #diagnostics(relay, health) {

    const { relayUrl } = relay;
    const row = (term, value, valueClass = "") => [
      h("dt", { class: "muted" }, term),
      h("dd", { class: valueClass }, value),
    ];

    return h("details", {
      class: "relay-details small",
      open: this.openDiagnostics.has(relayUrl),
      ontoggle: (event) => {
        if (event.target.open) {
          this.openDiagnostics.add(relayUrl);
        }
        else {
          this.openDiagnostics.delete(relayUrl);
        }
      },
    },
      h("summary", {}, "Diagnostics"),
      h("dl", { class: "relay-meta" },
        row("Status", health.label),
        row("Last success", formatTime(relay.lastSuccessAt)),
        row("Last failure", formatTime(relay.lastFailureAt)),
        row("Failures in a row", String(relay.failureCount ?? 0)),
        row("Current error", relay.lastFailureReason ?? "None", relay.lastFailureReason ? "warn" : "muted"),
        row("Next try", health.retryAt ? `after ${formatTime(health.retryAt)}` : relay.disabled ? "Never (disabled)" : "Next sync"),
        row("Relay key", relay.relayPkh ? shortHex(relay.relayPkh, 12, 6) : "Not learned yet", relay.relayPkh ? "mono" : "muted"),
        row("Epoch", relay.epoch ?? "None yet", relay.epoch ? "mono" : "muted"),
        row("Cursor", String(relay.cursor ?? 0), "mono")
      )
    );
  }

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

function maskToken(token) {
  return `••••${token.slice(-4)}`;
}

function aboutRelays() {

  return h("section", { class: "card" },
    h("div", { class: "label" }, "About relays"),
    h("p", { class: "muted small" },
      h("strong", {}, "What a relay is."),
      " Relays store encrypted messages, forward them to other relays, and " +
      "do their best to deliver each one to its recipient. They can't " +
      "decrypt your messages."),
    h("p", { class: "muted small" },
      h("strong", {}, "Why use several."),
      " Each message you send goes to all your enabled relays. More relays " +
      "means a message still gets through when one is down or drops it."),
    h("p", { class: "muted small" },
      h("strong", {}, "Archive or relay."),
      " An archive keeps messages indefinitely. A relay keeps them only for " +
      "a while, typically until you've downloaded them or about a week has " +
      "passed. Choose the type the relay's operator states. Neither type " +
      "guarantees delivery."),
    h("p", { class: "muted small" },
      h("strong", {}, "Access token."),
      " Only needed if the relay requires one. Its operator gives it to you.")
  );
}
