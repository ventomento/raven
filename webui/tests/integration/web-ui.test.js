import { document, text, button, submit, container, until } from "../helpers/dom-env.js";

import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, StorageMemory } from "../../../index.js";
import { WebUi } from "../../src/index.js";
import { ThreadView } from "../../src/views/thread-view.js";
import { startRelay } from "../../../smerp/tests/helpers/relay-fixtures.js";

// WebUi with real SmerpClients against the mock relay over HTTP.

async function startUi(t, { relays = [], storage = new StorageMemory(), ...options } = {}) {

    const identity = await PrivateIdentity.generate();
    const root = container();

    const ui = new WebUi({
        privateKeyHex: await identity.exportPrivateHex(),
        root,
        storage,
        relays,
        ...options,
    });

    await ui.start();
    t.after(() => ui.stop());

    return { ui, root, identity, storage };
}

test("start seeds the relays it is given unless already stored", async (t) => {

    const { relay } = await startRelay(t);
    const storage = new StorageMemory();
    await storage.relaysPut({ ...relay, disabled: true });

    const { ui } = await startUi(t, {
        storage,
        relays: [
            { relayUrl: `${relay.relayUrl}/`, relayType: "relay" },
            { relayUrl: " http://127.0.0.1:1// " },
        ],
    });

    const stored = await ui.client.relaysGet();
    const byUrl = Object.fromEntries(stored.map(r => [r.relayUrl, r]));

    assert.equal(stored.length, 2);
    assert.equal(byUrl[relay.relayUrl].disabled, true, "the user's edit survives");
    assert.equal(byUrl[relay.relayUrl].relayType, "archive");
    assert.equal(byUrl["http://127.0.0.1:1"].relayType, "relay");
});

test("bad keys are refused up front", async () => {

    const privateKeyHex = await (await PrivateIdentity.generate()).exportPrivateHex();
    const root = container();

    assert.throws(() => new WebUi({ privateKeyHex, root, recipientPublicKeyHex: "nope" }), /recipientPublicKeyHex/);
    assert.throws(() => new WebUi({ privateKeyHex, root, relays: [{ relayUrl: "http://a", relayPkh: "short" }] }), /relayPkh/);
    assert.throws(() => new WebUi({ privateKeyHex, root: {} }));
});

test("a message goes from Alice's Send view to Bob's thread, read and as text", async (t) => {

    const { relay } = await startRelay(t);

    const bob = await startUi(t, { relays: [relay] });
    const alice = await startUi(t, {
        relays: [relay],
        recipientPublicKeyHex: bob.identity.publicKeyHex,
    });

    const hostile = `<img src=x onerror="alert(1)"> hi bob`;

    // Alice: the Send view is open with Bob filled in
    assert.equal(alice.root.querySelector("input.mono").value, bob.identity.publicKeyHex);
    alice.root.querySelector("textarea").value = hostile;
    submit(alice.root.querySelector("form.compose"));

    // after sending, her thread with Bob opens and her message arrives through sync
    await until(() => alice.ui.shell.view instanceof ThreadView, { message: "alice's thread" });
    await until(() => text(alice.root.querySelector("ul.messages")).includes("hi bob"), { message: "alice's own message" });
    assert.match(text(alice.root.querySelector("li.message.outbound")), /^You/);

    // Bob: a sync brings a conversation with an unread badge
    await bob.ui.client.sync();
    const badge = bob.ui.shell.tabBar.badges.get("conversations");
    await until(() => badge.textContent === "1" && !badge.hidden, { message: "bob's badge" });

    const row = await (async () => {
        await until(() => bob.root.querySelector("button.row.unread"), { message: "bob's unread row" });
        return bob.root.querySelector("button.row.unread");
    })();
    assert.equal(row.title, alice.identity.publicKeyHex);

    // opening it shows the message as text and marks it read
    row.click();
    await until(() => text(bob.root.querySelector("ul.messages")).includes("hi bob"), { message: "bob's message" });

    const message = bob.root.querySelector("li.message.inbound .text");
    assert.equal(message.textContent, hostile);
    assert.equal(bob.root.querySelector("ul.messages img"), null);

    await until(async () => (await bob.ui.client.conversationsGet())[0].unreadCount === 0, { message: "read" });
    await until(() => badge.hidden, { message: "badge cleared" });
});

test("Bob replies from the thread and Alice's open thread shows it", async (t) => {

    const { relay } = await startRelay(t);

    const alice = await startUi(t, { relays: [relay] });
    const bob = await startUi(t, { relays: [relay] });

    alice.ui.shell.openThread(bob.identity.publicKeyHex);

    bob.ui.shell.openThread(alice.identity.publicKeyHex);
    bob.root.querySelector("textarea").value = "reply from bob";
    submit(bob.root.querySelector("form.compose"));
    await until(() => text(bob.root.querySelector("ul.messages")).includes("reply from bob"), { message: "bob's own copy" });

    await alice.ui.client.sync();
    await until(() => text(alice.root.querySelector("ul.messages")).includes("reply from bob"), { message: "alice's live thread" });

    // the open thread keeps the conversation read
    await until(async () => (await alice.ui.client.conversationsGet())[0].unreadCount === 0, { message: "read while open" });
});

test("a relay added in the Relays view is used", async (t) => {

    const { relay } = await startRelay(t);
    const { ui, root } = await startUi(t);

    button(root.querySelector("nav"), "Relays").click();
    const form = await (async () => {
        await until(() => root.querySelector("form.card"), { message: "add form" });
        return root.querySelector("form.card");
    })();

    form.querySelector("input[type=url]").value = relay.relayUrl;
    submit(form);

    await until(() => text(root).includes(relay.relayUrl), { message: "relay row" });
    await until(async () => (await ui.client.relaysGet())[0]?.relayPkh, { message: "relay key learned" });

    // the row shows the learned key after the RELAY event
    await until(() => !text(root).includes("Learned on first sync"), { message: "key shown" });
});

test("stop tears everything down; start and stop are idempotent", async (t) => {

    const { relay } = await startRelay(t);
    const { ui, root } = await startUi(t, { relays: [relay] });

    const client = ui.client;
    await ui.start();
    assert.equal(ui.client, client);

    assert.equal(document.head.querySelectorAll("link[rel=stylesheet]").length > 0, true);
    const stylesheet = ui.stylesheet;

    await ui.stop();
    await ui.stop();

    assert.equal(client.status, "stopped");
    assert.equal(root.children.length, 0);
    assert.equal(stylesheet.isConnected, false);
    assert.equal(ui.client, null);
});
