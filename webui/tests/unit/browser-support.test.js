import test from "node:test";
import assert from "node:assert/strict";

import {
    browserSupport,
    UnsupportedBrowserError,
    UnsupportedReasons,
} from "../../src/browser-support.js";

// Node has X25519 but no IndexedDB or isSecureContext: each test sets the
// globals it needs and restores them afterwards.
function withGlobal(t, name, value) {

    const original = Object.getOwnPropertyDescriptor(globalThis, name);

    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

    t.after(() => {
        if (original) {
            Object.defineProperty(globalThis, name, original);
        }
        else {
            delete globalThis[name];
        }
    });
}

// An indexedDB whose open() answers with outcome: "success", "error" or "throw".
function fakeIndexedDb(outcome) {

    const calls = [];

    return {
        calls,
        open(name) {
            calls.push(["open", name]);
            if (outcome === "throw") {
                throw new DOMException("blocked", "InvalidStateError");
            }
            const request = { result: { close: () => calls.push(["close"]) } };
            setTimeout(() => (outcome === "success" ? request.onsuccess : request.onerror)());
            return request;
        },
        deleteDatabase(name) {
            calls.push(["delete", name]);
        },
    };
}

test("supported with working crypto and IndexedDB; the probe database is removed", async (t) => {

    const indexedDB = fakeIndexedDb("success");
    withGlobal(t, "indexedDB", indexedDB);

    assert.deepEqual(await browserSupport(), { ok: true });

    const [[, name]] = indexedDB.calls;
    assert.deepEqual(indexedDB.calls, [["open", name], ["close"], ["delete", name]]);
});

test("IndexedDB is not checked when not asked for", async () => {

    assert.deepEqual(await browserSupport({ indexedDb: false }), { ok: true });
});

test("missing, throwing or failing IndexedDB is no-storage", async (t) => {

    assert.equal((await browserSupport()).reason, UnsupportedReasons.NO_STORAGE, "missing");

    withGlobal(t, "indexedDB", null);

    for (const outcome of ["throw", "error"]) {
        globalThis.indexedDB = fakeIndexedDb(outcome);
        const support = await browserSupport();
        assert.equal(support.ok, false, outcome);
        assert.equal(support.reason, UnsupportedReasons.NO_STORAGE, outcome);
        assert.match(support.message, /store data/, outcome);
    }
});

test("no WebCrypto is insecure-context outside a secure context, no-crypto inside one", async (t) => {

    withGlobal(t, "crypto", {});

    withGlobal(t, "isSecureContext", false);
    assert.equal((await browserSupport()).reason, UnsupportedReasons.INSECURE_CONTEXT);

    globalThis.isSecureContext = true;
    const support = await browserSupport();
    assert.equal(support.reason, UnsupportedReasons.NO_CRYPTO);
    assert.match(support.message, /X25519/);
});

test("UnsupportedBrowserError carries the reason and the user message", () => {

    const error = new UnsupportedBrowserError(UnsupportedReasons.INSECURE_CONTEXT);

    assert.ok(error instanceof Error);
    assert.equal(error.name, "UnsupportedBrowserError");
    assert.equal(error.reason, UnsupportedReasons.INSECURE_CONTEXT);
    assert.match(error.message, /HTTPS/);
});
