import test from "node:test";
import assert from "node:assert/strict";

import {
  qrMatrix,
  reedSolomonDivisor,
  reedSolomonRemainder,
  formatBits,
  versionBits,
  alignmentPositions,
  penaltyScore,
} from "../../src/qr.js";
import { QR_FIXTURES } from "../helpers/qr-fixtures.js";

const toRows = matrix => matrix.map(row => row.map(dark => (dark ? "1" : "0")).join(""));

test("Reed-Solomon matches the spec's worked example (1-M, \"01234567\")", () => {

  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];

  assert.deepEqual(
    reedSolomonRemainder(data, reedSolomonDivisor(10)),
    [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]
  );
});

test("format bits for level M match the spec's table", () => {

  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map(mask => formatBits(mask).toString(2).padStart(15, "0")),
    [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ]
  );
});

test("version bits match the spec's table", () => {

  assert.equal(versionBits(7).toString(2).padStart(18, "0"), "000111110010010100");
  assert.equal(versionBits(40).toString(2).padStart(18, "0"), "101000110001101001");
});

test("alignment pattern positions match the spec's table", () => {

  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test("matrices match segno's for the same text and mask", () => {

  for (const { text, version, mask, rows } of QR_FIXTURES) {

    const matrix = qrMatrix(text, { mask });

    assert.equal(matrix.length, version * 4 + 17, text);
    assert.deepEqual(toRows(matrix), rows, text);
  }
});

test("finders, timing and the dark module are where the spec puts them", () => {

  const matrix = qrMatrix("raven-7393d61a4b43bc37bd434fd736f061f4");
  const size = matrix.length;
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  const block = (x, y) => matrix.slice(y, y + 7).map(row => row.slice(x, x + 7).map(d => (d ? "1" : "0")).join(""));

  assert.deepEqual(block(0, 0), finder);
  assert.deepEqual(block(size - 7, 0), finder);
  assert.deepEqual(block(0, size - 7), finder);

  for (let i = 8; i < size - 8; i++) {
    assert.equal(matrix[6][i], i % 2 === 0);
    assert.equal(matrix[i][6], i % 2 === 0);
  }

  assert.equal(matrix[size - 8][8], true);
});

test("picks the smallest version, and the mask with the lowest penalty", () => {

  assert.equal(qrMatrix("a").length, 21);
  assert.equal(qrMatrix("x".repeat(14)).length, 21, "14 bytes fit 1-M");
  assert.equal(qrMatrix("x".repeat(15)).length, 25);
  assert.equal(qrMatrix("x".repeat(2331)).length, 177, "the most 40-M holds");

  const text = "raven-7393d61a4b43bc37bd434fd736f061f4";
  const chosen = penaltyScore(qrMatrix(text));

  for (let mask = 0; mask < 8; mask++) {
    assert.ok(chosen <= penaltyScore(qrMatrix(text, { mask })));
  }
});

test("counts UTF-8 bytes, and refuses what no version holds", () => {

  assert.equal(qrMatrix("Æ".repeat(7)).length, 21, "14 bytes");
  assert.equal(qrMatrix("Æ".repeat(8)).length, 25, "16 bytes");
  assert.throws(() => qrMatrix("x".repeat(2332)), RangeError);
});
