// src/crypto/aes-gcm.js

export async function encryptAesGcm({
  key,
  iv,
  plaintext,
  additionalData = null
}) {

  if (!(iv instanceof Uint8Array) || iv.length !== 12) {
    throw new Error("IV must be 12 bytes");
  }

  if (!(plaintext instanceof Uint8Array)) {
    throw new Error("plaintext must be Uint8Array");
  }

  const algorithm = {
    name: "AES-GCM",
    iv,
    tagLength: 128
  };

  if (additionalData) {
    algorithm.additionalData = additionalData;
  }

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      algorithm,
      key,
      plaintext
    )
  );

  // WebCrypto returns:
  // ciphertext || tag

  const ciphertext = encrypted.slice(0, -16);
  const auth_tag = encrypted.slice(-16);

  return {
    ciphertext,
    auth_tag
  };
}

export async function decryptAesGcm({
  key,
  iv,
  ciphertext,
  auth_tag,
  additionalData = null
}) {

  if (!(iv instanceof Uint8Array) || iv.length !== 12) {
    throw new Error("IV must be 12 bytes");
  }

  if (!(ciphertext instanceof Uint8Array)) {
    throw new Error("ciphertext must be Uint8Array");
  }

  if (!(auth_tag instanceof Uint8Array) || auth_tag.length !== 16) {
    throw new Error("auth_tag must be 16 bytes");
  }

  const combined = new Uint8Array(
    ciphertext.length + auth_tag.length
  );

  combined.set(ciphertext, 0);
  combined.set(auth_tag, ciphertext.length);

  const algorithm = {
    name: "AES-GCM",
    iv,
    tagLength: 128
  };

  if (additionalData) {
    algorithm.additionalData = additionalData;
  }

  const plaintext = await crypto.subtle.decrypt(
    algorithm,
    key,
    combined
  );

  return new Uint8Array(plaintext);
}