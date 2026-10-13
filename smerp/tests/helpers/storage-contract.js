// Rules every storage must follow (storage/storage-interface.js):
// envelope ordering and pagination, put/get/delete semantics, detached copies.
// Run against a backend with: storageContract(test, () => new Storage()).

import assert from "node:assert/strict";

const envelope = (uuid, sentAt, receivedAt, publicKeyHex = "conversationA") => ({
    uuid,
    publicKeyHex,
    senderPublicKeyHex: "s",
    recipientPublicKeyHex: "r",
    contentType: 1,
    plaintext: uuid,
    sentAt,
    receivedAt,
});

// Two pairs share a sentAt second; receivedAt orders them.
const FIXTURE = [
    envelope("a", 1000, 1500),
    envelope("b", 2000, 2100),
    envelope("c", 2000, 2200),
    envelope("d", 3000, 3300),
    envelope("e", 3000, 3400),
    envelope("x", 9000, 9000, "conversationB"),
];

export function storageContract(test, makeStorage) {

    async function fresh(t) {

        const storage = await makeStorage();
        await storage.init();
        t.after(() => storage.close());

        return storage;
    }

    async function seeded(t) {

        const storage = await fresh(t);

        // insert out of order
        for (const e of [...FIXTURE].reverse()) {
            await storage.envelopesPut(e);
        }

        return storage;
    }

    const uuids = (list) => list.map(e => e.uuid);

    test("all envelopes newest first, ties by receivedAt", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(uuids(await storage.envelopesGet()), ["x", "e", "d", "c", "b", "a"]);
    });

    test("conversation envelopes newest first, ties by receivedAt", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(
            uuids(await storage.envelopesGet({ publicKeyHex: "conversationA" })),
            ["e", "d", "c", "b", "a"]
        );
    });

    test("beforeSentAt alone is exclusive of the whole second", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(
            uuids(await storage.envelopesGet({ publicKeyHex: "conversationA", beforeSentAt: 3000 })),
            ["c", "b", "a"]
        );
    });

    test("beforeSentAt with beforeReceivedAt is exclusive of the pair", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(
            uuids(await storage.envelopesGet({
                publicKeyHex: "conversationA",
                beforeSentAt: 3000,
                beforeReceivedAt: 3400,
            })),
            ["d", "c", "b", "a"]
        );
    });

    test("paging by the last record's pair visits every envelope once", async (t) => {

        const storage = await seeded(t);
        const seen = [];
        let position = {};

        for (;;) {

            const page = await storage.envelopesGet({
                publicKeyHex: "conversationA",
                limit: 1,
                ...position,
            });

            if (page.length === 0) {
                break;
            }

            seen.push(...uuids(page));

            const last = page.at(-1);
            position = { beforeSentAt: last.sentAt, beforeReceivedAt: last.receivedAt };
        }

        assert.deepEqual(seen, ["e", "d", "c", "b", "a"]);
    });

    test("uuid lookup", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(uuids(await storage.envelopesGet({ uuid: "c" })), ["c"]);
        assert.deepEqual(await storage.envelopesGet({ uuid: "missing" }), []);
    });

    test("envelopes: limit caps the result, newest kept", async (t) => {
        const storage = await seeded(t);
        assert.deepEqual(uuids(await storage.envelopesGet({ limit: 2 })), ["x", "e"]);
    });

    test("envelopes: put returns the uuid and replaces the whole record", async (t) => {
        const storage = await seeded(t);

        assert.equal(await storage.envelopesPut({ uuid: "a", sentAt: 1, receivedAt: 1 }), "a");

        const [a] = await storage.envelopesGet({ uuid: "a" });
        assert.equal(a.sentAt, 1);
        assert.equal(a.publicKeyHex, undefined, "fields are not merged");
        assert.equal((await storage.envelopesGet()).length, FIXTURE.length);
    });

    test("envelopes: binary plaintext survives storage", async (t) => {
        const storage = await fresh(t);
        const plaintext = new Uint8Array([0, 1, 255]);

        await storage.envelopesPut({ ...envelope("bin", 1, 1), plaintext });

        const [stored] = await storage.envelopesGet({ uuid: "bin" });
        assert.ok(stored.plaintext instanceof Uint8Array);
        assert.deepEqual(stored.plaintext, plaintext);
    });

    test("conversations: put, get by key, replace", async (t) => {
        const storage = await fresh(t);

        assert.deepEqual(await storage.conversationsGet(), []);
        assert.equal(
            await storage.conversationsPut({ publicKeyHex: "p1", unreadCount: 2, lastMessageAt: 5 }),
            "p1"
        );
        await storage.conversationsPut({ publicKeyHex: "p2", unreadCount: 0, lastMessageAt: 9 });
        await storage.conversationsPut({ publicKeyHex: "p1", unreadCount: 0 });

        const [p1] = await storage.conversationsGet({ publicKeyHex: "p1" });
        assert.deepEqual(p1, { publicKeyHex: "p1", unreadCount: 0 });
        assert.equal((await storage.conversationsGet()).length, 2);
        assert.deepEqual(await storage.conversationsGet({ publicKeyHex: "missing" }), []);
    });

    test("relays: put, get by key, replace, delete returns a count", async (t) => {
        const storage = await fresh(t);

        assert.equal(await storage.relaysPut({ relayUrl: "http://a", relayType: "archive", cursor: 3 }), "http://a");
        await storage.relaysPut({ relayUrl: "http://b", relayType: "relay" });
        await storage.relaysPut({ relayUrl: "http://a", relayType: "relay" });

        const [a] = await storage.relaysGet({ relayUrl: "http://a" });
        assert.deepEqual(a, { relayUrl: "http://a", relayType: "relay" });
        assert.equal((await storage.relaysGet()).length, 2);
        assert.deepEqual(await storage.relaysGet({ relayUrl: "http://missing" }), []);

        assert.equal(await storage.relaysDelete({ relayUrl: "http://a" }), 1);
        assert.equal(await storage.relaysDelete({ relayUrl: "http://a" }), 0);
        assert.deepEqual((await storage.relaysGet()).map(r => r.relayUrl), ["http://b"]);
    });

    test("records are detached copies, both ways", async (t) => {
        const storage = await fresh(t);

        const input = { publicKeyHex: "p", unreadCount: 1 };
        await storage.conversationsPut(input);
        input.unreadCount = 99;

        const [conversation] = await storage.conversationsGet();
        conversation.unreadCount = 42;
        assert.equal((await storage.conversationsGet())[0].unreadCount, 1);

        await storage.relaysPut({ relayUrl: "http://a", relayType: "archive" });
        (await storage.relaysGet())[0].relayType = "mutated";
        assert.equal((await storage.relaysGet())[0].relayType, "archive");

        await storage.envelopesPut(envelope("u", 1, 1));
        (await storage.envelopesGet({ uuid: "u" }))[0].plaintext = "mutated";
        (await storage.envelopesGet())[0].sentAt = 0;
        const [stored] = await storage.envelopesGet({ uuid: "u" });
        assert.equal(stored.plaintext, "u");
        assert.equal(stored.sentAt, 1);
    });
}
