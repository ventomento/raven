import test from "node:test";
import assert from "node:assert/strict";

import { PrivateIdentity, PublicIdentity, encrypt } from "../../smep/src/index.js";
import { Ingestor } from "../src/ingest/ingestor.js";
import { StorageMemory } from "../src/storage/storage-memory.js";
import { EventBus, EventTypes } from "../src/event/event-bus.js";
import { LightLog } from "../src/log/light-log.js";

// Every operation resolves on a later macrotask, like IndexedDB request
// callbacks, so concurrent ingests can interleave between steps.
class StorageAsync extends StorageMemory {}

for (const method of [
    "envelopesGet", "envelopesPut",
    "conversationsGet", "conversationsPut",
]) {
    StorageAsync.prototype[method] = async function (...args) {
        await new Promise(r => setTimeout(r, 0));
        return StorageMemory.prototype[method].apply(this, args);
    };
}

async function setup() {

    const alice = await PrivateIdentity.generate();
    const bob = await PrivateIdentity.generate();
    const eventBus = new EventBus();
    const storage = new StorageAsync();

    const ingestor = new Ingestor({
        storage,
        identity: bob,
        eventBus,
        logger: new LightLog(),
    });

    const seal = (plaintext) => encrypt({
        sender: alice,
        recipient: new PublicIdentity(bob.publicKey),
        plaintext,
    });

    return { alice, bob, eventBus, storage, ingestor, seal };
}

// The same envelope fetched from two relays at once, as parallel relay
// syncs do. Fails intermittently without Ingestor's writeLock.
test("concurrent ingest of the same envelope stores and counts it once", async () => {

    const { alice, eventBus, storage, ingestor, seal } = await setup();
    const bytes = await seal("hi");

    let events = 0;
    eventBus.subscribe(EventTypes.ENVELOPE, () => events++);

    const results = await Promise.all([
        ingestor.ingest(bytes),
        ingestor.ingest(bytes),
    ]);
    await new Promise(r => setTimeout(r, 0));

    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(events, 1);

    const [conversation] = await storage.conversationsGet({ publicKeyHex: alice.publicKeyHex });
    assert.equal(conversation.unreadCount, 1);
});
