// A QR code encoder (ISO/IEC 18004), only as much as the subscribe dialog
// needs: byte mode (UTF-8), error correction level M, versions 1 to 40, the
// mask with the lowest penalty. DOM-free; qrMatrix returns rows of booleans
// (true = dark), without the quiet zone.

// Per version (index 0 unused), for level M.
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

const ECC_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const LEVEL_M_FORMAT = 0b00;
const BYTE_MODE = 0b0100;
const PAD_BYTES = [0xec, 0x11];

export function qrMatrix(text, { mask = null } = {}) {

  const data = new TextEncoder().encode(text);
  const version = smallestVersion(data.length);
  const codewords = addEccAndInterleave(dataCodewords(data, version), version);

  const qr = new QrGrid(version);
  qr.drawFunctionPatterns();
  qr.drawCodewords(codewords);

  const chosen = mask ?? bestMask(qr);

  qr.applyMask(chosen);
  qr.drawFormatBits(chosen);

  return qr.modules;
}

function smallestVersion(byteCount) {

  for (let version = 1; version <= 40; version++) {

    const bits = 4 + charCountBits(version) + byteCount * 8;

    if (bits <= numDataCodewords(version) * 8) {
      return version;
    }
  }

  throw new RangeError("Text too long for a QR code");
}

function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

// Modules left for data and error correction once the function patterns
// (finders, timing, alignment, format and version info) are drawn.
function numRawDataModules(version) {

  let result = (16 * version + 128) * version + 64;

  if (version >= 2) {

    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;

    if (version >= 7) {
      result -= 36;
    }
  }

  return result;
}

function numDataCodewords(version) {
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version] * ECC_BLOCKS[version];
}

function dataCodewords(data, version) {

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((value >>> i) & 1);
    }
  };

  push(BYTE_MODE, 4);
  push(data.length, charCountBits(version));

  for (const byte of data) {
    push(byte, 8);
  }

  const capacity = numDataCodewords(version) * 8;

  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - bits.length % 8) % 8);

  const codewords = [];

  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }

  for (let i = 0; codewords.length < capacity / 8; i++) {
    codewords.push(PAD_BYTES[i % 2]);
  }

  return codewords;
}

// Splits the data into blocks, appends each block's error correction and
// interleaves them. Short blocks come first; long ones have one more data
// codeword.
function addEccAndInterleave(data, version) {

  const numBlocks = ECC_BLOCKS[version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - rawCodewords % numBlocks;
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(eccLength);

  const blocks = [];

  for (let i = 0, k = 0; i < numBlocks; i++) {

    const block = data.slice(k, k + shortBlockLength - eccLength + (i < numShortBlocks ? 0 : 1));
    k += block.length;

    const ecc = reedSolomonRemainder(block, divisor);

    if (i < numShortBlocks) {
      block.push(0);
    }

    blocks.push(block.concat(ecc));
  }

  const result = [];

  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLength - eccLength || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }

  return result;
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMultiply(x, y) {

  let z = 0;

  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }

  return z;
}

export function reedSolomonDivisor(degree) {

  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;

  let root = 1;

  for (let i = 0; i < degree; i++) {

    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }

    root = gfMultiply(root, 0x02);
  }

  return result;
}

export function reedSolomonRemainder(data, divisor) {

  const result = divisor.map(() => 0);

  for (const byte of data) {

    const factor = byte ^ result.shift();
    result.push(0);

    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }

  return result;
}

// 15 bits: level and mask, BCH(15,5) remainder, XOR mask.
export function formatBits(mask) {

  const data = (LEVEL_M_FORMAT << 3) | mask;
  let remainder = data;

  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }

  return ((data << 10) | remainder) ^ 0x5412;
}

// 18 bits: version, BCH(18,6) remainder. Only versions 7 and up carry it.
export function versionBits(version) {

  let remainder = version;

  for (let i = 0; i < 12; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }

  return (version << 12) | remainder;
}

export function alignmentPositions(version) {

  if (version === 1) {
    return [];
  }

  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;

  const result = [6];

  for (let position = size - 7; result.length < numAlign; position -= step) {
    result.splice(1, 0, position);
  }

  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function bestMask(qr) {

  let best = 0;
  let lowest = Infinity;

  for (let mask = 0; mask < MASKS.length; mask++) {

    qr.applyMask(mask);
    qr.drawFormatBits(mask);

    const penalty = penaltyScore(qr.modules);

    if (penalty < lowest) {
      best = mask;
      lowest = penalty;
    }

    qr.applyMask(mask);
  }

  return best;
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

// The four penalty rules of the spec: runs of five or more, 2x2 blocks,
// finder-like patterns, and the balance of dark and light.
export function penaltyScore(modules) {

  const size = modules.length;
  const columns = modules.map((_, x) => modules.map(row => row[x]));
  let score = 0;

  for (const line of [...modules, ...columns]) {

    let run = 1;

    for (let i = 1; i <= size; i++) {

      if (i < size && line[i] === line[i - 1]) {
        run += 1;
        continue;
      }

      if (run >= 5) {
        score += 3 + run - 5;
      }

      run = 1;
    }

    for (let i = 0; i + 11 <= size; i++) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((dark, k) => line[i + k] === dark)) {
          score += 40;
        }
      }
    }
  }

  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {

      const color = modules[y][x];

      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
        score += 3;
      }
    }
  }

  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const percent = (dark * 100) / (size * size);

  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

class QrGrid {

  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  setFunction(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {

    const { size } = this;

    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }

    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);

    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;

    positions.forEach((x, i) => {
      positions.forEach((y, j) => {
        const nearFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!nearFinder) {
          this.drawAlignment(x, y);
        }
      });
    });

    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  drawFinder(cx, cy) {

    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {

        const x = cx + dx;
        const y = cy + dy;

        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  drawAlignment(cx, cy) {

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(mask) {

    const { size } = this;
    const bits = formatBits(mask);
    const bit = i => ((bits >>> i) & 1) === 1;

    for (let i = 0; i <= 5; i++) {
      this.setFunction(8, i, bit(i));
    }

    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));

    for (let i = 9; i < 15; i++) {
      this.setFunction(14 - i, 8, bit(i));
    }

    for (let i = 0; i < 8; i++) {
      this.setFunction(size - 1 - i, 8, bit(i));
    }

    for (let i = 8; i < 15; i++) {
      this.setFunction(8, size - 15 + i, bit(i));
    }

    this.setFunction(8, size - 8, true);
  }

  drawVersionBits() {

    if (this.version < 7) {
      return;
    }

    const bits = versionBits(this.version);

    for (let i = 0; i < 18; i++) {

      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);

      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  // Zigzag from the bottom right, two columns at a time, skipping the
  // vertical timing column.
  drawCodewords(codewords) {

    const { size } = this;
    let i = 0;

    for (let right = size - 1; right >= 1; right -= 2) {

      if (right === 6) {
        right = 5;
      }

      for (let vertical = 0; vertical < size; vertical++) {
        for (let j = 0; j < 2; j++) {

          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;

          if (!this.isFunction[y][x] && i < codewords.length * 8) {
            this.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i += 1;
          }
        }
      }
    }
  }

  // XOR, so applying the same mask twice undoes it.
  applyMask(mask) {

    const test = MASKS[mask];

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && test(x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }
}
