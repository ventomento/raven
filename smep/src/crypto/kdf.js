import { sha256 } from "./hash.js";

// legacy naming: deriveAesKey

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

export async function deriveHmacKey(sharedSecret) {
  
  if (!(sharedSecret instanceof Uint8Array)) {
    throw new TypeError("Expected Uint8Array");
  }

  const rawKey = await sha256(sharedSecret);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  return cryptoKey;

}