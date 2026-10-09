// Envelope ordering and pagination rules every storage must follow.
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

    async function seeded(t) {

        const storage = await makeStorage();
        await storage.init();
        t.after(() => storage.close());

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
}
