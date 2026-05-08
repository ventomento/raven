// src/encoding/uuid.js

export function generateUuidBytes() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  // RFC4122 version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytes;
}

export function uuidBytesToString(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new Error("UUID must be 16 bytes");
  }

  const hex = [...bytes]
    .map(b => b.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

export function uuidStringToBytes(uuid) {
  if (typeof uuid !== "string") {
    throw new TypeError("Expected UUID string");
  }

  const clean = uuid.replace(/-/g, "");

  if (!/^[0-9a-fA-F]{32}$/.test(clean)) {
    throw new Error("Invalid UUID");
  }

  const out = new Uint8Array(16);

  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }

  return out;
}