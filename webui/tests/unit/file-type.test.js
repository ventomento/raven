import test from "node:test";
import assert from "node:assert/strict";
import { detectFileType } from "../../src/file-type.js";

const ascii = (s) => [...s].map(c => c.charCodeAt(0));

test("detectFileType: recognizes common formats by signature", () => {
  const cases = [
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], "png"],
    [[0xff, 0xd8, 0xff, 0xe0], "jpg"],
    [ascii("GIF89a"), "gif"],
    [[...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")], "webp"],
    [[...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVEfmt ")], "wav"],
    [ascii("%PDF-1.7"), "pdf"],
    [[0, 0, 0, 0x20, ...ascii("ftypisom")], "mp4"],
    [[0x50, 0x4b, 0x03, 0x04, 0x14], "zip"],
  ];

  for (const [bytes, ext] of cases) {
    assert.equal(detectFileType(new Uint8Array(bytes))?.ext, ext);
  }
});

test("detectFileType: null for unknown or too short input", () => {
  assert.equal(detectFileType(new Uint8Array([1, 2, 3, 4, 5])), null);
  assert.equal(detectFileType(new Uint8Array([0x89, 0x50])), null);
  assert.equal(detectFileType(new Uint8Array(ascii("RIFF"))), null);
});
