import { window, document, settle, text, button, submit, container } from "../helpers/dom-env.js";

import test from "node:test";
import assert from "node:assert/strict";

import { EventTypes, ContentTypes } from "../../../index.js";
import { ConversationsView } from "../../src/views/conversations-view.js";
import { ThreadView } from "../../src/views/thread-view.js";
import { RelaysView } from "../../src/views/relays-view.js";
import { IdentityView } from "../../src/views/identity-view.js";
import { SendView } from "../../src/views/send-view.js";
import { FakeClient, PEER, envelope } from "../helpers/fake-client.js";

const OTHER = "cc".repeat(32);

// A shell that records navigation.
function fakeShell() {

    const shell = { opened: [], closed: 0 };
    shell.openThread = pk => shell.opened.push(pk);
    shell.closeThread = () => shell.closed++;

    return shell;
}

async function mount(View, options = {}) {

    const client = options.client ?? new FakeClient();
    const shell = fakeShell();
    const el = container();
    const view = new View({ client, shell, ...options });

    view.mount(el);
    await settle();

    return { client, shell, el, view };
}

// ============================================================
// ConversationsView
// ============================================================

test("Conversations: empty state", async () => {

    const { el } = await mount(ConversationsView);

    assert.match(text(el), /No conversations yet/);
});

test("Conversations: newest first, unread badge only when unread", async () => {

    const client = new FakeClient();
    await client.storage.conversationsPut({ publicKeyHex: PEER, unreadCount: 2, lastMessageAt: 2000 });
    await client.storage.conversationsPut({ publicKeyHex: OTHER, unreadCount: 0, lastMessageAt: 1000 });

    const { el } = await mount(ConversationsView, { client });

    const rows = [...el.querySelectorAll("button.row")];
    assert.deepEqual(rows.map(r => r.title), [PEER, OTHER]);

    assert.ok(rows[0].classList.contains("unread"));
    assert.equal(rows[0].querySelector(".badge").textContent, "2");
    assert.equal(rows[1].classList.contains("unread"), false);
    assert.equal(rows[1].querySelector(".badge"), null);
    assert.match(text(rows[0]), /bbbbbbbbbbbb…bbbbbb/);
});

test("Conversations: picking one opens its thread", async () => {

    const client = new FakeClient();
    await client.storage.conversationsPut({ publicKeyHex: PEER, unreadCount: 0, lastMessageAt: 1 });

    const { el, shell } = await mount(ConversationsView, { client });

    el.querySelector("button.row").click();
    assert.deepEqual(shell.opened, [PEER]);
});

test("Conversations: re-render on CONVERSATION only, once per burst", async () => {

    const { client, el, view } = await mount(ConversationsView);
    const renders = () => client.callsTo("conversationsGet").length;
    const before = renders();

    view.onEvent({ type: EventTypes.ENVELOPE, envelope: envelope({ uuid: "x" }) });
    await settle();
    assert.equal(renders(), before);

    await client.storage.conversationsPut({ publicKeyHex: PEER, unreadCount: 1, lastMessageAt: 1 });
    for (let i = 0; i < 5; i++) {
        view.onEvent({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER } });
    }
    await settle();

    assert.equal(renders(), before + 1);
    assert.equal(el.querySelectorAll("button.row").length, 1);

    view.unmount();
    view.onEvent({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER } });
    await settle();
    assert.equal(renders(), before + 1, "nothing after unmount");
});

// ============================================================
// ThreadView
// ============================================================

async function seedThread(client, count, { sameSecond = false } = {}) {

    for (let i = 0; i < count; i++) {
        await client.storage.envelopesPut(envelope({
            uuid: `e${String(i).padStart(3, "0")}`,
            sentAt: sameSecond ? 5000 : 1000 * (i + 1),
            receivedAt: 1000 * (i + 1),
            direction: i % 2 ? "outbound" : "inbound",
        }));
    }

    await client.storage.envelopesPut(envelope({ uuid: "other", peer: OTHER }));
}

const messageTexts = (el) => [...el.querySelectorAll("li.message .text")].map(m => m.textContent);

test("Thread: newest first, own messages marked, other peers left out", async () => {

    const client = new FakeClient();
    await seedThread(client, 3);

    const { el } = await mount(ThreadView, { client, publicKeyHex: PEER });

    assert.deepEqual(messageTexts(el), ["text e002", "text e001", "text e000"]);

    const items = [...el.querySelectorAll("li.message")];
    assert.ok(items[1].classList.contains("outbound"));
    assert.match(text(items[1]), /^You/);
    assert.ok(items[0].classList.contains("inbound"));
    assert.match(text(items[0]), /^Peer/);

    assert.deepEqual(client.callsTo("envelopesGet")[0], [{ publicKeyHex: PEER, limit: 50 }]);
    assert.equal(button(el, "Load older").hidden, true);
});

test("Thread: empty state", async () => {

    const { el } = await mount(ThreadView, { publicKeyHex: PEER });

    assert.match(text(el), /No messages yet/);
});

test("Thread: Load older pages by the last envelope's sentAt and receivedAt", async () => {

    const client = new FakeClient();
    await seedThread(client, 60);

    const { el } = await mount(ThreadView, { client, publicKeyHex: PEER });

    assert.equal(messageTexts(el).length, 50);
    const older = button(el, "Load older");
    assert.equal(older.hidden, false);

    older.click();
    await settle();

    const [, second] = client.callsTo("envelopesGet");
    assert.deepEqual(second, [{ publicKeyHex: PEER, beforeSentAt: 11000, beforeReceivedAt: 11000, limit: 50 }]);

    assert.equal(messageTexts(el).length, 60);
    assert.equal(new Set(messageTexts(el)).size, 60);
    assert.equal(older.hidden, true);
});

test("Thread: paging does not skip envelopes sharing a second", async () => {

    const client = new FakeClient();
    await seedThread(client, 70, { sameSecond: true });

    const { el } = await mount(ThreadView, { client, publicKeyHex: PEER });

    button(el, "Load older").click();
    await settle();

    assert.equal(new Set(messageTexts(el)).size, 70);
});

test("Thread: a new envelope for this peer is prepended once", async () => {

    const { el, view } = await mount(ThreadView, { publicKeyHex: PEER });

    const fresh = envelope({ uuid: "new", plaintext: "just now" });

    view.onEvent({ type: EventTypes.ENVELOPE, envelope: fresh });
    view.onEvent({ type: EventTypes.ENVELOPE, envelope: fresh });
    view.onEvent({ type: EventTypes.ENVELOPE, envelope: envelope({ uuid: "elsewhere", peer: OTHER }) });

    assert.deepEqual(messageTexts(el), ["just now"]);
    assert.equal(el.querySelector("li.empty"), null);
});

test("Thread: marks read on open and while open when unread arrives", async () => {

    const { client, view } = await mount(ThreadView, { publicKeyHex: PEER });

    assert.deepEqual(client.callsTo("markRead"), [[PEER]]);

    view.onEvent({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER, unreadCount: 1 } });
    view.onEvent({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER, unreadCount: 0 } });
    view.onEvent({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: OTHER, unreadCount: 3 } });
    await settle();

    assert.deepEqual(client.callsTo("markRead"), [[PEER], [PEER]]);
});

test("Thread: Back closes, the reply form sends to this peer", async () => {

    const { client, shell, el } = await mount(ThreadView, { publicKeyHex: PEER });

    button(el, "Back").click();
    assert.equal(shell.closed, 1);

    el.querySelector("textarea").value = "reply";
    submit(el.querySelector("form"));
    await settle();

    assert.deepEqual(client.callsTo("send")[0].slice(0, 2), [PEER, "reply"]);
});

test("Thread: renders file envelopes as downloads", async () => {

    const client = new FakeClient();
    await client.storage.envelopesPut(envelope({ uuid: "f".repeat(32), contentType: ContentTypes.FILE, plaintext: new Uint8Array(5) }));

    const { el } = await mount(ThreadView, { client, publicKeyHex: PEER });

    assert.match(text(el.querySelector("button.download")), /Download file \(5 B\)/);
});

// ============================================================
// RelaysView
// ============================================================

const RELAY_PKH = "dd".repeat(32);

async function relaysView(relays = []) {

    const client = new FakeClient();

    for (const relay of relays) {
        await client.storage.relaysPut(relay);
    }

    return mount(RelaysView, { client });
}

const rows = (el) => [...el.querySelectorAll("li.relay")];

test("Relays: empty state", async () => {

    const { el } = await relaysView();

    assert.match(text(el), /No relays/);
});

test("Relays: rows show type, key, masked token and health, sorted by url", async () => {

    const { el } = await relaysView([
        { relayUrl: "http://b.test", relayType: "relay", relayPkh: RELAY_PKH, relayToken: "supersecret", failureCount: 2, lastFailureReason: "<b>unauthorized</b>" },
        { relayUrl: "http://a.test", relayType: "archive" },
    ]);

    const [a, b] = rows(el);

    assert.match(text(a), /http:\/\/a\.test/);
    assert.match(text(a), /Learned on first sync/);
    assert.match(text(a), /Access token\s*None/);
    assert.match(text(a), /Last sync never/);

    assert.match(text(b), /relay/);
    assert.match(text(b), /dddddddd…dddd/);
    assert.match(text(b), /••••cret/);
    assert.doesNotMatch(text(b), /supersecret/);
    assert.match(text(b), /2 failures in a row/);
    assert.match(text(b), /<b>unauthorized<\/b>/, "the relay's reason is text");
    assert.equal(b.querySelector("b"), null);
});

test("Relays: Disable, Enable and Remove", async () => {

    const relay = { relayUrl: "http://a.test", relayType: "archive" };
    const { client, el, view } = await relaysView([relay]);

    button(el, "Disable").click();
    await settle();
    assert.deepEqual(client.callsTo("relaysPut").at(-1), [{ ...relay, disabled: true }]);

    view.onEvent({ type: EventTypes.RELAY });
    await settle();
    assert.match(text(rows(el)[0]), /Disabled/);
    assert.ok(rows(el)[0].classList.contains("disabled"));

    button(el, "Enable").click();
    await settle();
    assert.deepEqual(client.callsTo("relaysPut").at(-1), [{ ...relay, disabled: false }]);

    button(el, "Remove").click();
    await settle();
    assert.deepEqual(client.callsTo("relaysDelete"), [[{ relayUrl: relay.relayUrl }]]);
});

test("Relays: the token editor saves and clears onto the current record", async () => {

    const { client, el } = await relaysView([{ relayUrl: "http://a.test", relayType: "archive", cursor: 9 }]);

    const editor = el.querySelector("details.token-editor");
    const input = editor.querySelector("input");

    input.value = "  fresh  ";
    submit(editor.querySelector("form"));
    await settle();

    assert.deepEqual(client.callsTo("relaysPut").at(-1), [{ relayUrl: "http://a.test", relayType: "archive", cursor: 9, relayToken: "fresh" }]);
    assert.equal(input.value, "");

    button(editor, "Clear").click();
    await settle();
    assert.equal(client.callsTo("relaysPut").at(-1)[0].relayToken, null);
});

test("Relays: a re-render keeps what is being typed in a token editor", async () => {

    const { el, view } = await relaysView([{ relayUrl: "http://a.test", relayType: "archive" }]);

    const input = el.querySelector("details.token-editor input");
    input.value = "half typed";

    view.onEvent({ type: EventTypes.RELAY });
    await settle();

    assert.equal(el.querySelector("details.token-editor input"), input);
    assert.equal(input.value, "half typed");
});

test("Relays: the add form trims the url and leaves an empty token out", async () => {

    const { client, el } = await relaysView();

    const form = el.querySelector("form.card");
    form.querySelector("input[type=url]").value = "  https://relay.test/// ";
    form.querySelector("select").value = "relay";
    submit(form);
    await settle();

    assert.deepEqual(client.callsTo("relaysPut"), [[{ relayUrl: "https://relay.test", relayType: "relay", relayToken: null }]]);
    assert.equal(form.querySelector("input[type=url]").value, "");
});

test("Relays: a refused add shows why", async () => {

    const { client, el } = await relaysView();
    client.relaysPut = async () => { throw new Error("nope"); };

    const form = el.querySelector("form.card");
    form.querySelector("input[type=url]").value = "https://relay.test";
    submit(form);
    await settle();

    const status = form.querySelector(".form-status");
    assert.equal(status.textContent, "nope");
    assert.ok(status.classList.contains("error"));
});

// ============================================================
// IdentityView and SendView
// ============================================================

test("Identity: public key shown, private key only when revealed", async () => {

    const identity = { exportPrivateHex: async () => "ee".repeat(32) };
    const { el } = await mount(IdentityView, { identity });

    assert.match(text(el), new RegExp("aa".repeat(32)));
    assert.doesNotMatch(text(el), /eeee/);

    button(el, "Reveal").click();
    await settle();
    assert.match(text(el), new RegExp("ee".repeat(32)));

    button(el, "Hide").click();
    await settle();
    assert.doesNotMatch(text(el), /eeee/);
});

test("Send: prefilled recipient, and the thread opens after sending", async () => {

    const { client, shell, el } = await mount(SendView, { recipientPublicKeyHex: PEER });

    const recipient = el.querySelector("input.mono");
    assert.equal(recipient.value, PEER);

    el.querySelector("textarea").value = "hi";
    submit(el.querySelector("form"));
    await settle();

    assert.equal(client.callsTo("send").length, 1);
    assert.deepEqual(shell.opened, [PEER]);
});
