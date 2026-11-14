/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
