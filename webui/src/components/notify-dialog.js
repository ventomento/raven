import { h } from "../dom.js";
import { ntfyAppLink, isDefaultNtfyServer } from "../notify-links.js";
import { qrCode } from "./qr-code.js";
import { copyButton } from "./copy-button.js";

// The dialog for subscribing a phone to "peer -> me": everything for both
// platforms at once, no guessing which device it is open on. Android
// subscribes from a deep link; the iOS app has none, so iPhone gets the topic
// as text to paste. Removes itself when closed. label names the peer in the
// text; displayName names the subscription in the Android app.
export function openNotifyDialog({ container, topic, ntfyUrl, label, displayName }) {

  const link = ntfyAppLink(ntfyUrl, topic, displayName);

  const dialog = h("dialog", { class: "notify-dialog", "aria-labelledby": "notify-dialog-title" },
    h("h2", { id: "notify-dialog-title" }, "Phone notifications"),
    h("p", {},
      `Get a phone notification when ${label} messages you. `,
      "Install the ntfy app, then scan the code for your phone."
    ),
    h("div", { class: "notify-platforms" },
      h("section", { class: "notify-platform" },
        h("h3", {}, "Android"),
        qrCode(link, "QR code that subscribes the ntfy app"),
        h("a", { class: "button-link", href: link }, "Open in ntfy"),
        topicRow(topic)
      ),
      h("section", { class: "notify-platform" },
        h("h3", {}, "iPhone"),
        qrCode(topic, "QR code of the topic"),
        topicRow(topic),
        h("p", { class: "muted small" },
          "Scan and copy the text, or copy it here. In ntfy, tap +, paste it and subscribe. " +
          "Allow notifications when asked, and rename the subscription after the contact."
        )
      )
    ),
    !isDefaultNtfyServer(ntfyUrl) && h("p", { class: "small" },
      "Server: ", h("span", { class: "mono" }, ntfyUrl),
      h("span", { class: "muted" }, ". On iPhone, turn on “Use another server” and enter it.")
    ),
    h("ul", { class: "muted small notify-notes" },
      h("li", {}, "Works only if their client sends notifications."),
      h("li", {}, "Anyone with this topic can see when this peer messages you. Keep it private."),
      h("li", {}, "If notifications stop, delete the subscription in ntfy and add it again.")
    ),
    h("form", { method: "dialog", class: "notify-actions" },
      h("button", { class: "primary", type: "submit" }, "Close")
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
      "aria-label": "Topic",
      onfocus: (event) => event.target.select(),
    }),
    copyButton(() => topic)
  );
}
