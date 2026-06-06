// src/encoding/utf8.js

export function encodeUtf8(str) {
  if (typeof str !== "string") {
    throw new TypeError("Expected string");
  }

  const encoder = new TextEncoder();
  return encoder.encode(str);
}

export function decodeUtf8(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}