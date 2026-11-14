import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as root from "@ventomento/raven";
import * as smep from "@ventomento/raven/smep";
import * as smerp from "@ventomento/raven/smerp";
import * as webui from "@ventomento/raven/webui";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

const names = module => Object.keys(module).sort();

// Exact lists: every export is a semver promise, so adding or removing one has
// to be deliberate.

test("root: the client and what a consumer needs to use it", () => {

    assert.deepEqual(names(root), [
        "ClientStatus", "ContentTypes", "DispatchError", "EventTypes", "IndexedDbStorage",
        "MAX_CONVERSATION_NAME", "NotStartedError", "PrivateIdentity", "PublicIdentity",
        "RelayThrottledError", "SmerpClient", "SmerpError", "StorageMemory",
    ]);
});

test("smep: identities, envelopes and the checks a custom client needs", () => {

    assert.deepEqual(names(smep), [
        "ContentTypes", "EnvelopeLayout", "PrivateIdentity", "PublicIdentity",
        "cryptoSupport", "decrypt", "decryptEnvelope", "encrypt", "envelopeHash",
        "notifyTopic", "readEnvelope",
    ]);
});

test("smerp: what a custom client or a relay builds on", () => {

    assert.deepEqual(names(smerp), [
        "ClientStatus", "DispatchError", "EventTypes", "IndexedDbStorage", "Ingestor", "Logger",
        "MAX_BATCH_BYTES", "MAX_CONVERSATION_NAME", "MAX_ENVELOPE_BYTES", "MAX_RESPONSE_BYTES",
        "NotStartedError", "NtfyNotifier", "RelaySession", "RelayThrottledError", "RequestBuilder",
        "RequestVerifier", "Scheduler", "SmerpClient", "SmerpError", "SmerpHeaders", "Status",
        "StorageInterface", "StorageMemory", "TransportDefault", "TransportInterface",
        "decodeBatch", "encodeBatch", "parseCursor", "parseRetryAfter",
    ]);
});

test("webui: the browser UI, and only there", () => {

    assert.deepEqual(names(webui), ["UnsupportedBrowserError", "UnsupportedReasons", "WebUi", "browserSupport"]);

    for (const module of [root, smerp]) {
        assert.equal("WebUi" in module, false);
    }
});

test("the mock relay is not part of the package", () => {

    assert.equal("./testing" in pkg.exports, false);

    for (const module of [root, smep, smerp, webui]) {
        assert.equal("SmerpServer" in module, false);
        assert.equal("StorageServer" in module, false);
    }
});

test("every entry point shares one copy of the identity classes", () => {
    assert.equal(root.PrivateIdentity, smep.PrivateIdentity);
    assert.equal(root.SmerpClient, smerp.SmerpClient);
    assert.equal(root.EventTypes, smerp.EventTypes);
});

test("no stylesheet export: the web UI brings its own styles", () => {
    assert.equal("./webui.css" in pkg.exports, false);
});

// The declarations are written by hand, so a missing or stale one must fail.
test("each entry point's declarations name exactly its runtime exports", () => {

    for (const [entry, module] of [["./smep", smep], ["./smerp", smerp], ["./webui", webui], [".", root]]) {

        const source = readFileSync(new URL(pkg.exports[entry].types, new URL("../../../", import.meta.url)), "utf8");

        const declared = [...source.matchAll(/^export (?:class|function|const) (\w+)/gm)].map(match => match[1]);

        const reexported = [...source.matchAll(/^export \{([^}]*)\}/gm)]
            .flatMap(match => match[1].split(",").map(name => name.trim()).filter(Boolean));

        assert.deepEqual([...declared, ...reexported].sort(), names(module), entry);
    }
});
