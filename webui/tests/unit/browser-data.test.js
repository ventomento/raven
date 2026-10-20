import test from "node:test";
import assert from "node:assert/strict";

import { deleteAllDatabases } from "../../src/browser-data.js";

// outcomes: database name → "success" | "error" | "blocked" | "throw".
function fakeFactory(outcomes, { listable = true } = {}) {

    const deleted = [];

    const factory = {
        deleted,
        deleteDatabase(name) {
            const outcome = outcomes[name];
            if (outcome === "throw") {
                throw new TypeError("bad name");
            }
            deleted.push(name);
            const request = {};
            setTimeout(() => {
                if (outcome === "blocked") {
                    request.onblocked();
                    request.onsuccess();
                }
                else {
                    (outcome === "error" ? request.onerror : request.onsuccess)();
                }
            });
            return request;
        },
    };

    if (listable) {
        factory.databases = async () => Object.keys(outcomes).map(name => ({ name, version: 1 }));
    }

    return factory;
}

test("deletes every database the browser lists, not only the fallback", async () => {

    const factory = fakeFactory({ "storage-a": "success", "storage-b": "success", other: "success" });

    const result = await deleteAllDatabases({ factory, fallbackNames: ["storage-a"] });

    assert.deepEqual(result, {
        listed: true,
        deleted: ["storage-a", "storage-b", "other"],
        blocked: [],
        failed: [],
    });
    assert.deepEqual(factory.deleted, ["storage-a", "storage-b", "other"]);
});

test("without databases() it deletes only the fallback names", async () => {

    const factory = fakeFactory({ "storage-a": "success", other: "success" }, { listable: false });

    const result = await deleteAllDatabases({ factory, fallbackNames: ["storage-a"] });

    assert.deepEqual(result, { listed: false, deleted: ["storage-a"], blocked: [], failed: [] });
    assert.deepEqual(factory.deleted, ["storage-a"]);
});

test("reports blocked and failed deletions instead of waiting or throwing", async () => {

    const factory = fakeFactory({ a: "success", b: "blocked", c: "error", d: "throw" });

    const result = await deleteAllDatabases({ factory });

    assert.deepEqual(result, { listed: true, deleted: ["a"], blocked: ["b"], failed: ["c", "d"] });
});

test("nothing to delete resolves empty", async () => {

    assert.deepEqual(
        await deleteAllDatabases({ factory: fakeFactory({}) }),
        { listed: true, deleted: [], blocked: [], failed: [] }
    );
});
