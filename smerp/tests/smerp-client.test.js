import test from "node:test";
import assert from "node:assert/strict";

import {
    SmerpClient,
    ClientStatus,
    EventTypes,
    NotStartedError,
    DispatchError,
    ContentTypes,
    PrivateIdentity,
} from "../../index.js";

import { SmerpServer } from "../src/server/index.js";

// End-to-end against the mock relay on an ephemeral port.

// Cleanup is registered with t.after so a failed assertion does not
// leave a server or client running and hang the test process.

async function startRelay(t) {

    const server = new SmerpServer();
    await server.listen(0, "127.0.0.1");
    t.after(() => server.close());

    return {
        server,
        relay: {
            relayUrl: `http://127.0.0.1:${server.server.address().port}`,
            relayType: "archive",
            relayPkh: SmerpServer.PUBLIC_KEY_HEX,
        },
    };
}

async function startClient(t, relay) {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
        syncIntervalMs: 60 * 60 * 1000,
    });

    await client.start();
    t.after(() => client.stop());

    if (relay) {
        await client.relaysPut(relay);
    }

    return client;
}

function nextEvent(client, type, predicate = () => true) {
    return new Promise((resolve) => {
        const off = client.on(type, (event) => {
            if (predicate(event)) {
                off();
                resolve(event);
            }
        });
    });
}

test("methods throw NotStartedError before start and after stop", async (t) => {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
    });

    assert.equal(client.status, ClientStatus.STOPPED);
    await assert.rejects(client.relaysGet(), NotStartedError);
    assert.throws(() => client.sync(), NotStartedError);

    await client.start();
    assert.equal(client.status, ClientStatus.RUNNING);
    assert.match(client.publicKeyHex, /^(0x)?[0-9a-f]{64}$/);

    await client.stop();
    assert.equal(client.status, ClientStatus.STOPPED);
    await assert.rejects(client.envelopesGet(), NotStartedError);
});

test("status events follow the lifecycle", async (t) => {

    const client = new SmerpClient({
        identity: await PrivateIdentity.generate(),
    });

    const statuses = [];
    client.on(EventTypes.STATUS, (e) => statuses.push(e.status));

    await client.start();
    await client.stop();
    await new Promise(r => setTimeout(r, 0));

    assert.deepEqual(statuses, ["starting", "running", "stopping", "stopped"]);
});

test("relays: put, get, delete with events", async (t) => {

    const client = await startClient(t);
    const relay = {
        relayUrl: "http://127.0.0.1:1",
        relayType: "archive",
        relayPkh: SmerpServer.PUBLIC_KEY_HEX,
    };

    const putEvent = nextEvent(client, EventTypes.RELAY);
    assert.equal(await client.relaysPut(relay), relay.relayUrl);
    assert.equal((await putEvent).deleted, false);

    // put with the same url replaces, does not duplicate
    await client.relaysPut({ ...relay, relayType: "other" });
    const relays = await client.relaysGet();
    assert.equal(relays.length, 1);
    assert.equal(relays[0].relayType, "other");

    assert.equal((await client.relaysGet({ relayUrl: relay.relayUrl })).length, 1);
    assert.equal((await client.relaysGet({ relayUrl: "http://nope" })).length, 0);

    const deleteEvent = nextEvent(client, EventTypes.RELAY, e => e.deleted);
    assert.equal(await client.relaysDelete({ relayUrl: relay.relayUrl }), 1);
    assert.equal((await deleteEvent).relay.relayUrl, relay.relayUrl);
    assert.equal(await client.relaysDelete({ relayUrl: relay.relayUrl }), 0);
    assert.deepEqual(await client.relaysGet(), []);

    await assert.rejects(client.relaysPut({ relayUrl: "x" }));
});

test("send without relays throws DispatchError", async (t) => {

    const client = await startClient(t);
    const bob = await PrivateIdentity.generate();

    await assert.rejects(
        client.send(await bob.exportPublicHex(), "hi"),
        (error) => error instanceof DispatchError && error.failed.length === 0
    );
});

test("send accepts only string or Uint8Array", async (t) => {

    const { relay } = await startRelay(t);
    const client = await startClient(t, relay);

    for (const plaintext of [{ not: "bytes" }, new ArrayBuffer(4), 42]) {
        await assert.rejects(
            client.send(client.publicKeyHex, plaintext),
            TypeError
        );
    }
});

test("text and bytes round-trip between two clients through a relay", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    // text. Subscribe first: bob's background sync may fetch it any time.
    const received = nextEvent(bob, EventTypes.ENVELOPE);
    const sent = await alice.send(bob.publicKeyHex, "hello bob");

    assert.deepEqual(sent.delivered, [relay.relayUrl]);
    assert.deepEqual(sent.failed, []);
    assert.match(sent.uuid, /^[0-9a-f]{32}$/);

    // the sender stores its own envelope only via sync, like any other
    await alice.sync();
    const [own] = await alice.envelopesGet({ uuid: sent.uuid });
    assert.equal(own.direction, "outbound");
    assert.equal(own.plaintext, "hello bob");
    assert.equal(own.contentType, ContentTypes.TEXT_UTF8);

    await bob.sync();

    const { envelope } = await received;
    assert.equal(envelope.uuid, sent.uuid);
    assert.equal(envelope.direction, "inbound");
    assert.equal(envelope.plaintext, "hello bob");

    // bytes
    const bytes = new Uint8Array([0, 1, 2, 255]);

    const sentBytes = await alice.send(bob.publicKeyHex, bytes);

    await bob.sync();

    const [binary] = await bob.envelopesGet({ uuid: sentBytes.uuid });
    assert.equal(binary.contentType, ContentTypes.UNKNOWN);
    assert.ok(binary.plaintext instanceof Uint8Array);
    assert.deepEqual(binary.plaintext, bytes);

    assert.equal(
        (await bob.envelopesGet({ publicKeyHex: alice.publicKeyHex })).length,
        2
    );

    // repeated syncs do not store anything twice
    await alice.sync();
    await alice.sync();
    assert.equal(
        (await alice.envelopesGet({ publicKeyHex: bob.publicKeyHex })).length,
        2
    );

});

test("an envelope held by several relays is stored and counted once", async (t) => {

    const one = await startRelay(t);
    const two = await startRelay(t);
    const alice = await startClient(t, one.relay);
    await alice.relaysPut(two.relay);
    const bob = await startClient(t, one.relay);
    await bob.relaysPut(two.relay);

    const sent = await alice.send(bob.publicKeyHex, "hi");
    assert.equal(sent.delivered.length, 2);

    let envelopeEvents = 0;
    bob.on(EventTypes.ENVELOPE, () => envelopeEvents++);

    await bob.sync();
    await new Promise(r => setTimeout(r, 0));

    assert.equal(envelopeEvents, 1);
    assert.equal((await bob.envelopesGet()).length, 1);

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});

test("conversations track unread count and can be marked read with put", async (t) => {

    const { server, relay } = await startRelay(t);
    const alice = await startClient(t, relay);
    const bob = await startClient(t, relay);

    await alice.send(bob.publicKeyHex, "one");
    await alice.send(bob.publicKeyHex, "two");
    await bob.sync();

    const [conversation] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 2);

    const updated = nextEvent(bob, EventTypes.CONVERSATION);
    await bob.conversationsPut({ ...conversation, unreadCount: 0 });
    assert.equal((await updated).conversation.unreadCount, 0);

    const [read] = await bob.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(read.unreadCount, 0);

    // sender side: outbound messages are not unread
    const [aliceSide] = await alice.conversationsGet({ publicKeyHex: bob.publicKeyHex });
    assert.equal(aliceSide.unreadCount, 0);

});

test("records returned by get are detached copies", async (t) => {

    const { server, relay } = await startRelay(t);
    const client = await startClient(t, relay);

    const [r] = await client.relaysGet();
    r.relayType = "mutated";

    const [again] = await client.relaysGet();
    assert.equal(again.relayType, "archive");

});
