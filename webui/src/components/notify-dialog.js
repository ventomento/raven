import { h } from "../dom.js";
import { ntfyAppLink, isDefaultNtfyServer } from "../notify-links.js";
import { qrCode } from "./qr-code.js";
import { copyButton } from "./copy-button.js";

// The dialog for subscribing a phone to "peer -> me": the topic (called "the
// code" in the UI) to copy, then a QR code per platform, both always shown, no
// guessing which device it is open on. Android's subscribes through a deep
// link; the iOS app has none, so iPhone's holds the topic as text to paste. Removes itself when closed. label names the peer in the
// text; displayName names the subscription in the Android app.
export function openNotifyDialog({ container, topic, ntfyUrl, label, displayName }) {

  const link = ntfyAppLink(ntfyUrl, topic, displayName);

  const dialog = h("dialog", { class: "notify-dialog", "aria-labelledby": "notify-dialog-title" },
    h("h2", { id: "notify-dialog-title" }, "Phone notifications"),
    h("p", {},
      `Get a phone notification when ${label} messages you. `,
      "Install the ntfy app and subscribe to this code."
    ),
    h("div", { class: "notify-code" },
      h("div", { class: "muted small" }, "Copy it and paste it into the ntfy app (tap +):"),
      topicRow(topic)
    ),
    h("div", { class: "notify-platforms" },
      h("section", { class: "notify-platform" },
        h("h3", {}, "Android"),
        qrCode(link, "QR code that opens the ntfy app and subscribes"),
        h("p", { class: "muted small" }, "Scan with the camera to open ntfy and subscribe.")
      ),
      h("section", { class: "notify-platform" },
        h("h3", {}, "iPhone"),
        qrCode(topic, "QR code of the code"),
        h("p", { class: "muted small" }, "Scan with the camera to copy the code, then paste it into ntfy (tap +).")
      )
    ),
    !isDefaultNtfyServer(ntfyUrl) && h("p", { class: "small" },
      "Server: ", h("span", { class: "mono" }, ntfyUrl),
      h("span", { class: "muted" }, ". On iPhone, turn on \u201cUse another server\u201d and enter it.")
    ),
    h("p", { class: "muted small" }, "Works only if their client sends notifications."),
    h("p", { class: "muted small" },
      "You\u2019ll get at most one notification every 5 minutes from this conversation, " +
      "even if more messages arrive."
    ),
    h("form", { method: "dialog", class: "notify-actions" },
      h("button", { class: "primary", type: "submit", autofocus: true }, "Close")
    )
  );

  dialog.addEventListener("close", () => dialog.remove());

  container.append(dialog);
  dialog.showModal();

  return dialog;
}

// The topic in a read-only field (select it by hand where the clipboard API
// is unavailable) and a Copy button.
function topicRow(topic) {

  return h("div", { class: "copy-row" },
    h("input", {
      type: "text",
      class: "mono",
      value: topic,
      readOnly: true,
      "aria-label": "Code",
      onfocus: (event) => event.target.select(),
    }),
    copyButton(() => topic)
  );
}
