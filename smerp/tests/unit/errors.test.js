import test from "node:test";
import assert from "node:assert/strict";

import { SmerpError, NotStartedError, DispatchError } from "../../src/client/errors.js";

test("errors are SmerpErrors named after their class", () => {

    for (const error of [new NotStartedError(), new DispatchError([])]) {
        assert.ok(error instanceof SmerpError);
        assert.ok(error instanceof Error);
        assert.equal(error.name, error.constructor.name);
    }
});

test("DispatchError says whether there was no relay or every relay failed", () => {

    const none = new DispatchError([]);
    assert.equal(none.message, "no relays configured");
    assert.deepEqual(none.failed, []);

    const failed = [
        { relayUrl: "http://a", error: new Error("x") },
        { relayUrl: "http://b", error: new Error("y") },
    ];
    const all = new DispatchError(failed);
    assert.equal(all.message, "dispatch failed to all 2 relays");
    assert.equal(all.failed, failed);
});
