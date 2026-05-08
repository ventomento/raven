// src/encoding/utf8.js

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeUtf8(str) {
  if (typeof str !== "string") {
    throw new TypeError("Expected string");
  }

  return encoder.encode(str);
}

export function decodeUtf8(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  return decoder.decode(bytes);
}