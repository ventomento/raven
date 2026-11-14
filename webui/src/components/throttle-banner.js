/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { h, replaceChildren, perFrame } from "../dom.js";
import { formatTime } from "../format.js";
import { throttleNotices } from "../relay-health.js";

// A notice on every tab while a relay refuses service for long. It reads the
// stored relay records, so it also shows after a reload. Sends explain their
// own failures in the compose form, whatever the length of the wait.
export class ThrottleBanner {

  constructor({ client, onOpenRelays }) {

    this.client = client;
    this.onOpenRelays = onOpenRelays;
    this.relays = [];
    this.dismissed = new Set();
    this.timer = null;
    this.destroyed = false;

    this.el = h("div", { class: "throttle-banner", role: "status", hidden: true });

    this.refresh = perFrame(() => void this.load());
    this.refresh();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  async load() {

    if (this.destroyed || this.client.status !== "running") {
      return;
    }

    const relays = await this.client.relaysGet();

    if (!this.destroyed) {
      this.relays = relays;
      this.render();
    }
  }

  render() {

    clearTimeout(this.timer);

    const now = Date.now();
    const { items, allBlocked, blockedUntil, nextChangeAt } = throttleNotices(this.relays, this.dismissed, now);

    if (nextChangeAt !== null) {
      this.timer = setTimeout(() => this.render(), Math.max(0, nextChangeAt - now) + 100);
    }

    this.el.hidden = items.length === 0;

    replaceChildren(this.el,
      items.length > 0 && allBlocked && blockedUntil > now
        ? h("strong", { class: "throttle-lead" },
            `All your relays are rate limiting you. You can't send or receive until ${formatTime(blockedUntil, now)}.`)
        : null,
      items.map(item => this.line(item, now))
    );
  }

  line(item, now) {

    const text = item.waiting
      ? `${item.relayUrl} is rate limiting you. Nothing can be sent or fetched through it until ${formatTime(item.throttledUntil, now)}.`
      : `${item.relayUrl} was rate limiting you. Retrying at the next sync.`;

    return h("div", { class: "throttle-line" },
      h("span", { class: "throttle-text" }, text),
      h("button", { class: "ghost", type: "button", onclick: () => this.onOpenRelays() }, "Relays"),
      h("button", {
        class: "ghost",
        type: "button",
        onclick: () => {
          this.dismissed.add(item.key);
          this.render();
        },
      }, "Dismiss")
    );
  }
}
