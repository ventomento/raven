import { window, document, settle, text, button, submit, setFiles, until } from "../helpers/dom-env.js";

import test from "node:test";
import assert from "node:assert/strict";

import { ContentTypes, DispatchError } from "../../../index.js";
import { Header } from "../../src/components/header.js";
import { TabBar } from "../../src/components/tab-bar.js";
import { envelopeContent } from "../../src/components/envelope-content.js";
import { ComposeForm } from "../../src/components/compose-form.js";
import { FakeClient, PEER, envelope } from "../helpers/fake-client.js";

// ============================================================
// Header
// ============================================================

test("Header shows the short key, sync state, and a dismissable error", () => {

    let syncs = 0;
    const header = new Header({ publicKeyHex: "ab".repeat(32), onSync: () => syncs++ });

    assert.match(text(header.el), /abababab…abab/);

    button(header.el, "Sync").click();
    assert.equal(syncs, 1);

    header.setSyncing(true);
    assert.equal(header.syncButton.textContent, "Syncing…");
    assert.ok(header.syncButton.classList.contains("syncing"));
    header.setSyncing(false);
    assert.equal(header.syncButton.textContent, "Sync");

    header.setError("relay down");
    assert.equal(header.errorLine.hidden, false);
    assert.equal(header.errorLine.textContent, "relay down");

    header.errorLine.click();
    assert.equal(header.errorLine.hidden, true);
    assert.equal(header.errorLine.textContent, "");
});

// ============================================================
// TabBar
// ============================================================

test("TabBar selects and badges tabs", () => {

    const picked = [];
    const bar = new TabBar({
        tabs: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
        onSelect: id => picked.push(id),
    });

    button(bar.el, "Two").click();
    assert.deepEqual(picked, ["two"]);

    bar.select("two");
    assert.equal(button(bar.el, "One").getAttribute("aria-selected"), "false");
    assert.equal(button(bar.el, "Two").getAttribute("aria-selected"), "true");

    const badge = bar.badges.get("one");
    assert.equal(badge.hidden, true);

    bar.setBadge("one", 3);
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, "3");

    bar.setBadge("one", 120);
    assert.equal(badge.textContent, "99+");

    bar.setBadge("one", 0);
    assert.equal(badge.hidden, true);
});

// ============================================================
// envelopeContent
// ============================================================

test("text envelopes render as text, never markup", () => {

    const hostile = `<img src=x onerror="alert(1)">`;
    const el = envelopeContent(envelope({ uuid: "a".repeat(32), plaintext: hostile }));

    assert.equal(el.textContent, hostile);
    assert.equal(el.querySelector("img"), null);
});

test("text envelopes stored as bytes are decoded", () => {

    const el = envelopeContent(envelope({
        uuid: "a".repeat(32),
        plaintext: new TextEncoder().encode("héllo"),
    }));

    assert.equal(el.textContent, "héllo");
});

test("other content gets a download button named by the guessed type", () => {

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const known = envelopeContent(envelope({ uuid: "1234abcd".repeat(4), plaintext: png, contentType: ContentTypes.FILE }));

    assert.equal(known.tagName, "BUTTON");
    assert.equal(known.textContent, "Download PNG (10 B)");

    const unknown = envelopeContent(envelope({ uuid: "1234abcd".repeat(4), plaintext: new Uint8Array(3), contentType: ContentTypes.UNKNOWN }));
    assert.equal(unknown.textContent, "Download file (3 B)");
});

test("the download is named smerp-<uuid prefix>.<ext>", () => {

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const el = envelopeContent(envelope({ uuid: "1234abcd".repeat(4), plaintext: png, contentType: ContentTypes.FILE }));

    const downloads = [];
    const click = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };

    try {
        el.click();
    }
    finally {
        window.HTMLAnchorElement.prototype.click = click;
    }

    assert.deepEqual(downloads, ["smerp-1234abcd.png"]);
});

// ============================================================
// ComposeForm
// ============================================================

function compose(options = {}) {

    const client = new FakeClient();
    const sent = [];
    const form = new ComposeForm({ client, onSent: pk => sent.push(pk), ...options });

    document.body.append(form.el);

    return { client, form, sent };
}

test("ComposeForm sends text to the typed recipient, normalized", async () => {

    const { client, form, sent } = compose();

    form.recipientInput.value = `  0x${PEER.toUpperCase()} `;
    form.textInput.value = "hello";
    submit(form.form);
    await settle();

    assert.deepEqual(client.callsTo("send"), [[PEER, "hello", { contentType: ContentTypes.TEXT_UTF8 }]]);
    assert.deepEqual(sent, [PEER]);
    assert.equal(form.textInput.value, "", "cleared after sending");
    assert.match(text(form.status), /Sent to 1 of 1 relays/);
    assert.equal(form.sendButton.disabled, false);
});

test("ComposeForm with a fixed recipient has no recipient field", async () => {

    const { client, form } = compose({ recipientPublicKeyHex: PEER });

    assert.equal(form.recipientInput, null);

    form.textInput.value = "reply";
    submit(form.form);
    await settle();

    assert.equal(client.callsTo("send")[0][0], PEER);
});

test("ComposeForm refuses a bad recipient or an empty message", async () => {

    const { client, form } = compose();

    form.recipientInput.value = "not a key";
    form.textInput.value = "hello";
    submit(form.form);
    await settle();
    assert.match(text(form.status), /64 character hex/);

    form.recipientInput.value = PEER;
    form.textInput.value = "   ";
    submit(form.form);
    await settle();
    assert.match(text(form.status), /Write a message first/);

    button(form.el, "File").click();
    submit(form.form);
    await settle();
    assert.match(text(form.status), /Choose a file first/);

    assert.deepEqual(client.callsTo("send"), []);
});

test("ComposeForm sends a file as FILE bytes", async () => {

    const { client, form } = compose({ recipientPublicKeyHex: PEER });

    button(form.el, "File").click();
    assert.equal(form.textInput.hidden, true);
    assert.equal(form.fileInput.hidden, false);
    assert.equal(button(form.el, "File").getAttribute("aria-pressed"), "true");

    setFiles(form.fileInput, [new File([new Uint8Array([1, 2, 3])], "x.bin")]);
    assert.match(text(form.status), /3 B/);

    submit(form.form);
    await until(() => client.callsTo("send").length === 1, { message: "send" });

    const [[recipient, plaintext, options]] = client.callsTo("send");
    assert.equal(recipient, PEER);
    assert.ok(plaintext instanceof Uint8Array);
    assert.deepEqual([...plaintext], [1, 2, 3]);
    assert.deepEqual(options, { contentType: ContentTypes.FILE });
});

test("ComposeForm warns on a partial delivery", async () => {

    const { client, form } = compose({ recipientPublicKeyHex: PEER });

    client.sendResult = {
        uuid: "u",
        delivered: ["http://a.test"],
        failed: [{ relayUrl: "http://b.test", error: new Error("down") }],
    };

    form.textInput.value = "hi";
    submit(form.form);
    await settle();

    assert.match(text(form.status), /Sent to 1 of 2 relays/);
    assert.ok(form.status.classList.contains("warn"));
});

test("ComposeForm explains a DispatchError per relay and keeps the text", async () => {

    const { client, form, sent } = compose({ recipientPublicKeyHex: PEER });

    client.sendError = new DispatchError([{ relayUrl: "http://a.test", error: new Error("Relay dispatch failed: 401 (expired)") }]);

    form.textInput.value = "hi";
    submit(form.form);
    await settle();

    assert.match(text(form.status), /dispatch failed to all 1 relays \(http:\/\/a\.test: Relay dispatch failed: 401 \(expired\)\)/);
    assert.ok(form.status.classList.contains("error"));
    assert.equal(form.textInput.value, "hi");
    assert.deepEqual(sent, []);

    client.sendError = new DispatchError([]);
    submit(form.form);
    await settle();
    assert.equal(text(form.status), "no relays configured");
});

test("ComposeForm: Ctrl+Enter submits", async () => {

    const { client, form } = compose({ recipientPublicKeyHex: PEER });

    form.textInput.value = "quick";
    form.textInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();

    assert.equal(client.callsTo("send").length, 1);
});
