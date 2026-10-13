import { window, document, settle, text, button, container } from "../helpers/dom-env.js";

import test from "node:test";
import assert from "node:assert/strict";

import { EventTypes } from "../../../index.js";
import { AppShell } from "../../src/app-shell.js";
import { ConversationsView } from "../../src/views/conversations-view.js";
import { ThreadView } from "../../src/views/thread-view.js";
import { SendView } from "../../src/views/send-view.js";
import { RelaysView } from "../../src/views/relays-view.js";
import { IdentityView } from "../../src/views/identity-view.js";
import { FakeClient, PEER, envelope } from "../helpers/fake-client.js";

const identity = { exportPrivateHex: async () => "ee".repeat(32) };

async function shell(options = {}) {

    const client = options.client ?? new FakeClient();
    const root = container();
    const app = new AppShell({ client, identity, root, ...options });

    await settle();

    return { client, root, app };
}

test("subscribes once to every event type, and destroy removes it all", async () => {

    const { client, root, app } = await shell();

    assert.deepEqual(
        client.callsTo("on").map(([type]) => type).sort(),
        Object.values(EventTypes).sort()
    );

    assert.ok(root.classList.contains("webui"));
    assert.ok(root.querySelector("header"));

    app.destroy();

    assert.equal(client.listenerCount(), 0);
    assert.equal(root.children.length, 0);
    assert.equal(root.classList.contains("webui"), false);
});

test("opens on Chats, or on Send with a recipient filled in", async () => {

    const chats = await shell();
    assert.ok(chats.app.view instanceof ConversationsView);
    assert.equal(button(chats.root, "Chats").getAttribute("aria-selected"), "true");

    const send = await shell({ recipientPublicKeyHex: PEER });
    assert.ok(send.app.view instanceof SendView);
    assert.equal(send.root.querySelector("input.mono").value, PEER);
});

test("tabs switch views", async () => {

    const { root, app } = await shell();

    for (const [label, View] of [["Relays", RelaysView], ["Identity", IdentityView], ["Send", SendView], ["Chats", ConversationsView]]) {
        button(root.querySelector("nav"), label).click();
        await settle();
        assert.ok(app.view instanceof View, label);
        assert.equal(button(root.querySelector("nav"), label).getAttribute("aria-selected"), "true");
    }
});

test("openThread and closeThread", async () => {

    const { root, app } = await shell();

    app.openThread(PEER);
    assert.ok(app.view instanceof ThreadView);
    assert.equal(app.view.publicKeyHex, PEER);
    assert.equal(button(root.querySelector("nav"), "Chats").getAttribute("aria-selected"), "true");

    app.closeThread();
    assert.ok(app.view instanceof ConversationsView);
});

test("SYNC drives the header's sync state", async () => {

    const { client, app } = await shell();

    client.emit({ type: EventTypes.SYNC, phase: "start" });
    assert.equal(app.header.syncButton.textContent, "Syncing…");

    client.emit({ type: EventTypes.SYNC, phase: "end" });
    assert.equal(app.header.syncButton.textContent, "Sync");

    button(app.header.el, "Sync").click();
    assert.equal(client.callsTo("sync").length, 1);
});

test("ERROR shows in the header, with its relay when it has one", async () => {

    const { client, app } = await shell();

    client.emit({ type: EventTypes.ERROR, error: new Error("unexpected status 500"), relayUrl: "http://a.test" });
    assert.equal(app.header.errorLine.textContent, "http://a.test: unexpected status 500");
    assert.equal(app.header.errorLine.hidden, false);

    client.emit({ type: EventTypes.ERROR, error: new Error("boom") });
    assert.equal(app.header.errorLine.textContent, "boom");
});

test("the Chats badge counts conversations with unread envelopes", async () => {

    const client = new FakeClient();
    await client.storage.conversationsPut({ publicKeyHex: PEER, unreadCount: 3, lastMessageAt: 1 });

    const { app } = await shell({ client });
    const badge = app.tabBar.badges.get("conversations");

    assert.equal(badge.textContent, "1");

    await client.storage.conversationsPut({ publicKeyHex: "cc".repeat(32), unreadCount: 1, lastMessageAt: 2 });
    client.emit({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: "cc".repeat(32) } });
    await settle();
    assert.equal(badge.textContent, "2");

    await client.storage.conversationsPut({ publicKeyHex: PEER, unreadCount: 0, lastMessageAt: 1 });
    await client.storage.conversationsPut({ publicKeyHex: "cc".repeat(32), unreadCount: 0, lastMessageAt: 2 });
    client.emit({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER } });
    await settle();
    assert.equal(badge.hidden, true);
});

test("the badge is not queried once the client has stopped", async () => {

    const { client, app } = await shell();

    app.selectTab("identity");     // a view that does not query on events
    await settle();
    const queries = client.callsTo("conversationsGet").length;

    client.status = "stopped";
    client.emit({ type: EventTypes.CONVERSATION, conversation: { publicKeyHex: PEER } });
    await settle();

    assert.equal(client.callsTo("conversationsGet").length, queries);
});

test("events reach the active view", async () => {

    const { client, root, app } = await shell();

    app.openThread(PEER);
    await settle();

    client.emit({ type: EventTypes.ENVELOPE, envelope: envelope({ uuid: "live", plaintext: "arrived" }) });

    assert.match(text(root.querySelector("ul.messages")), /arrived/);
});
