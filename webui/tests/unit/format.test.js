import test from "node:test";
import assert from "node:assert/strict";
import { shortHex, peerLabel, formatTime, formatBytes, parsePublicKeyHex } from "../../src/format.js";

test("shortHex: shortens long hex, keeps head and tail", () => {
  const hex = "0123456789abcdef0123456789abcdef";
  assert.equal(shortHex(hex), "01234567…cdef");
});

test("shortHex: leaves short hex unchanged", () => {
  assert.equal(shortHex("abcdef"), "abcdef");
  assert.equal(shortHex(undefined), "");
});

test("peerLabel: the name, else 'Note to self' for our own key, else null", () => {
    const own = "aa".repeat(32);
    const peer = "bb".repeat(32);
    assert.equal(peerLabel({ publicKeyHex: peer, name: "Alice" }, own), "Alice");
    assert.equal(peerLabel({ publicKeyHex: own, name: "Me" }, own), "Me");
    assert.equal(peerLabel({ publicKeyHex: own }, own), "Note to self");
    assert.equal(peerLabel({ publicKeyHex: peer }, own), null);
});

test("formatTime: 'never' for missing time", () => {
  assert.equal(formatTime(0), "never");
  assert.equal(formatTime(undefined), "never");
});

test("formatTime: today shows no date, other days do", () => {
  const now = new Date(2026, 9, 9, 15, 0).getTime();
  const today = new Date(2026, 9, 9, 9, 30).getTime();
  const earlier = new Date(2026, 9, 1, 9, 30).getTime();

  assert.ok(!formatTime(today, now).includes(new Date(today).toLocaleDateString()));
  assert.ok(formatTime(earlier, now).startsWith(new Date(earlier).toLocaleDateString()));
});

test("formatBytes: picks a unit", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("parsePublicKeyHex: normalizes prefix, case and whitespace", () => {
  const hex = "ab".repeat(32);
  assert.equal(parsePublicKeyHex(` 0x${hex.toUpperCase()} `), hex);
  assert.equal(parsePublicKeyHex(hex), hex);
});

test("parsePublicKeyHex: rejects wrong length or non-hex", () => {
  assert.equal(parsePublicKeyHex("ab".repeat(31)), null);
  assert.equal(parsePublicKeyHex("zz".repeat(32)), null);
});
