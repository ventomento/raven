import {
  generateKeyPair,
  exportPrivateKey,
  importPrivateKey,
  deriveSharedSecret,
} from "./x25519.js";

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
