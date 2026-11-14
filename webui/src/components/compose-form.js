/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ContentTypes } from "../../../index.js";
import { describeSendFailure, describeSendResult } from "../send-status.js";
import { h } from "../dom.js";
import { formatBytes, parsePublicKeyHex } from "../format.js";

export class ComposeForm {

  constructor({ client, recipientPublicKeyHex = null, onSent = () => {}, status = null }) {

    this.client = client;
    this.recipientPublicKeyHex = recipientPublicKeyHex;
    this.onSent = onSent;
    this.mode = "text";

    this.recipientInput = recipientPublicKeyHex ? null : h("input", {
      class: "mono",
      type: "text",
      placeholder: "Recipient address",
      autocomplete: "off",
      required: true,
    });

    this.textInput = h("textarea", {
      rows: 3,
      placeholder: "Message",
      onkeydown: (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.form.requestSubmit();
        }
      },
    });

    this.fileInput = h("input", {
      type: "file",
      hidden: true,
      onchange: () => this.#showFileSize(),
    });

    this.modeButtons = {
      text: h("button", { type: "button", onclick: () => this.#setMode("text") }, "Text"),
      file: h("button", { type: "button", onclick: () => this.#setMode("file") }, "File"),
    };

    this.sendButton = h("button", { class: "primary", type: "submit" }, "Send");
    this.status = h("div", { class: "form-status", role: "status" });

    this.form = h("form", {
      class: "compose",
      onsubmit: (e) => {
        e.preventDefault();
        void this.#send();
      },
    },
      this.recipientInput,
      this.textInput,
      this.fileInput,
      h("div", { class: "form-row" },
        h("div", { class: "segmented" }, this.modeButtons.text, this.modeButtons.file),
        this.sendButton
      ),
      this.status
    );

    this.el = this.form;
    this.#setMode("text");

    // A warning from a send made in another form, which that form's onSent
    // navigated away from.
    if (status) {
      this.#setStatus(status, "warn");
    }
  }

  #setMode(mode) {

    this.mode = mode;
    this.textInput.hidden = mode !== "text";
    this.fileInput.hidden = mode !== "file";

    for (const [key, button] of Object.entries(this.modeButtons)) {
      button.setAttribute("aria-pressed", String(key === mode));
    }

    this.#setStatus("");
  }

  #showFileSize() {
    const file = this.fileInput.files[0];
    this.#setStatus(file ? formatBytes(file.size) : "");
  }

  #setStatus(message, kind = "") {
    this.status.textContent = message;
    this.status.className = `form-status ${kind}`;
  }

  async #payload() {

    if (this.mode === "text") {
      const text = this.textInput.value;
      return text.trim() ? { plaintext: text, contentType: ContentTypes.TEXT_UTF8 } : null;
    }

    const file = this.fileInput.files[0];

    return file
      ? { plaintext: new Uint8Array(await file.arrayBuffer()), contentType: ContentTypes.FILE }
      : null;
  }

  async #send() {

    const recipient =
      this.recipientPublicKeyHex ?? parsePublicKeyHex(this.recipientInput.value);

    if (!recipient) {
      this.#setStatus("Recipient must be a 64 character hex public key.", "error");
      return;
    }

    const payload = await this.#payload();

    if (!payload) {
      this.#setStatus(this.mode === "text" ? "Write a message first." : "Choose a file first.", "error");
      return;
    }

    this.sendButton.disabled = true;
    this.#setStatus("Sending…");

    try {

      const result =
        await this.client.send(recipient, payload.plaintext, { contentType: payload.contentType });

      const message = describeSendResult(result);

      this.#setStatus(message, result.failed.length ? "warn" : "ok");

      this.textInput.value = "";
      this.fileInput.value = "";

      this.onSent(recipient, result.failed.length ? message : null);
    }
    catch (error) {
      this.#setStatus(describeSendFailure(error), "error");
    }
    finally {
      this.sendButton.disabled = false;
    }
  }
}
