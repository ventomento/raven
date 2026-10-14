import { h } from "../dom.js";

export class TabBar {

  constructor({ tabs, onSelect }) {

    this.buttons = new Map();
    this.badges = new Map();

    for (const { id, label } of tabs) {

      const badge = h("span", { class: "badge", hidden: true });

      this.badges.set(id, badge);
      this.buttons.set(id,
        h("button", {
          class: "tab",
          type: "button",
          role: "tab",
          onclick: () => onSelect(id),
        }, label, badge)
      );
    }

    this.el = h("nav", { class: "tabs", role: "tablist" }, [...this.buttons.values()]);
  }

  select(id) {
    for (const [tabId, button] of this.buttons) {
      button.setAttribute("aria-selected", String(tabId === id));
    }
  }

  setBadge(id, count) {
    const badge = this.badges.get(id);
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
  }
}
