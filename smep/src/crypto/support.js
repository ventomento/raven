// src/crypto/support.js

import {
  generateKeyPair,
  exportPrivateKey,
  importPrivateKey,
  deriveSharedSecret,
} from "./x25519.js";

/**
 * Whether this runtime has the WebCrypto smep needs. Resolves
 *
 *   { ok: true }
 *   { ok: false, reason: "no-webcrypto" }   no crypto.subtle (in a browser:
 *                                           usually not a secure context)
 *   { ok: false, reason: "no-x25519", error }
 *
 * X25519 is the recent part (Firefox 130, Safari 17, Chromium 133), and
 * having crypto.subtle says nothing about it, so the check runs the
 * operations smep uses: generate, export, import (pkcs8 and jwk) and ECDH.
 * Never rejects.
 */
export async function cryptoSupport() {

  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    return { ok: false, reason: "no-webcrypto" };
  }

  try {
    const generated = await generateKeyPair();
    const imported = await importPrivateKey(await exportPrivateKey(generated.privateKey));
    await deriveSharedSecret(imported.privateKey, generated.publicKey);
  }
  catch (error) {
    return { ok: false, reason: "no-x25519", error };
  }

  return { ok: true };
}
