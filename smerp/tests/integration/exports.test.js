import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as root from "raven";
import * as smep from "raven/smep";
import * as smerp from "raven/smerp";
import * as testing from "raven/testing";

const missing = (module, names) => names.filter(name => !(name in module));

test("raven: the client and what a consumer needs to use it", () => {

    assert.deepEqual(missing(root, [
        "SmerpClient", "ClientStatus", "SmerpError", "NotStartedError", "DispatchError",
        "EventTypes", "MAX_CONVERSATION_NAME", "StorageMemory", "IndexedDbStorage",
        "PrivateIdentity", "PublicIdentity", "ContentTypes",
    ]), []);
});

test("raven/smerp: the building blocks", () => {

    assert.deepEqual(missing(smerp, [
        "SmerpClient", "EventBus", "EventTypes",
        "StorageInterface", "StorageMemory", "IndexedDbStorage",
        "TransportInterface", "TransportDefault",
        "SmerpHeaders", "Status", "MAX_ENVELOPE_BYTES", "MAX_BATCH_BYTES", "MAX_RESPONSE_BYTES",
        "encodeBatch", "decodeBatch", "parseCursor",
        "Scheduler", "RelaySession", "RequestBuilder", "Ingestor", "MAX_CONVERSATION_NAME",
        "ConcurrencyLimiter", "TokenBucket", "RealClock",
        "AuthHeaders", "RequestVerifier",
        "canonicalRequest", "bodyHashHex", "hmacKeyFor", "normalizePkh",
        "Logger",
    ]), []);
});

test("raven/smep: the primitives", () => {

    assert.deepEqual(missing(smep, [
        "PrivateIdentity", "PublicIdentity",
        "encrypt", "decrypt", "createEnvelope", "decryptEnvelope", "readEnvelope",
        "EnvelopeLayout", "ContentTypes", "insist", "cryptoSupport",
    ]), []);
});

test("raven/testing: the mock relay, and only there", () => {

    assert.equal(typeof testing.SmerpServer, "function");

    for (const module of [root, smerp]) {
        assert.equal("SmerpServer" in module, false);
        assert.equal("StorageServer" in module, false);
        assert.equal("WebUi" in module, false);
    }
});

test("every entry point shares one copy of the identity classes", () => {
    assert.equal(root.PrivateIdentity, smep.PrivateIdentity);
    assert.equal(root.SmerpClient, smerp.SmerpClient);
    assert.equal(root.EventTypes, smerp.EventTypes);
});

test("no stylesheet export: the web UI brings its own styles", () => {

    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

    assert.equal("./webui.css" in pkg.exports, false);
});
