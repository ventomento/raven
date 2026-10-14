const TAG_LENGTH = 16;

function checkParams(iv, aad) {
  if (!(iv instanceof Uint8Array) || iv.length !== 12) {
    throw new Error("IV must be 12 bytes");
  }

  if (!(aad instanceof Uint8Array)) {
    throw new Error("aad must be Uint8Array");
  }
}

function algorithm(iv, aad) {
  return {
    name: "AES-GCM",
    iv,
    additionalData: aad,
    tagLength: TAG_LENGTH * 8,
  };
}

export async function encryptAesGcm({
  key,
  iv,
  plaintext,
  aad = new Uint8Array(0),
}) {

  checkParams(iv, aad);

  if (!(plaintext instanceof Uint8Array)) {
    throw new Error("plaintext must be Uint8Array");
  }

  return new Uint8Array(
    await crypto.subtle.encrypt(algorithm(iv, aad), key, plaintext)
  );
}

export async function decryptAesGcm({
  key,
  iv,
  ciphertextWithTag,
  aad = new Uint8Array(0),
}) {

  checkParams(iv, aad);

  if (
    !(ciphertextWithTag instanceof Uint8Array) ||
    ciphertextWithTag.length < TAG_LENGTH
  ) {
    throw new Error(`ciphertextWithTag must be at least ${TAG_LENGTH} bytes`);
  }

  return new Uint8Array(
    await crypto.subtle.decrypt(algorithm(iv, aad), key, ciphertextWithTag)
  );
}
