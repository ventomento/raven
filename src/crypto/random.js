// src/crypto/random.js

export function randomBytes(length) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Invalid length");
  }

  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomIV() {
  return randomBytes(12);
}