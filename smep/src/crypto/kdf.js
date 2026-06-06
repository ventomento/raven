import { sha256 } from "./hash.js";

export async function deriveAesKey(sharedSecret) {
  if (!(sharedSecret instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const rawKey = await sha256(sharedSecret);

  return crypto.subtle.importKey(
    "raw",
    rawKey,
    {
      name: "AES-GCM"
    },
    false,
    ["encrypt", "decrypt"]
  );
}