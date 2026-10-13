import test from "node:test";
import assert from "node:assert/strict";

import { cryptoSupport } from "../src/index.js";

// Replaces globalThis.crypto for one test.
function withCrypto(t, value) {

  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  Object.defineProperty(globalThis, "crypto", { value, configurable: true, writable: true });
  t.after(() => Object.defineProperty(globalThis, "crypto", original));
}

test("Node has what smep needs", async () => {

  assert.deepEqual(await cryptoSupport(), { ok: true });
});

test("no crypto.subtle is no-webcrypto", async (t) => {

  withCrypto(t, { getRandomValues: bytes => bytes });

  assert.deepEqual(await cryptoSupport(), { ok: false, reason: "no-webcrypto" });
});

test("a crypto.subtle without X25519 is no-x25519, with the error", async (t) => {

  const unsupported = new DOMException("Unrecognized name", "NotSupportedError");
  const subtle = new Proxy(crypto.subtle, {
    get: (target, name) => name === "generateKey"
      ? async () => { throw unsupported; }
      : target[name].bind(target),
  });

  withCrypto(t, { subtle, getRandomValues: crypto.getRandomValues.bind(crypto) });

  assert.deepEqual(await cryptoSupport(), { ok: false, reason: "no-x25519", error: unsupported });
});
