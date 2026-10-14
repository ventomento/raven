export { PrivateIdentity, PublicIdentity } from "./identity/identity.js";

export {
  encrypt,
  decrypt,
  createEnvelope,
  decryptEnvelope,
  envelopeHash,
} from "./protocol/protocol.js";

export { EnvelopeWriter } from "./envelope/envelope-writer.js";
export { readEnvelope } from "./envelope/envelope-reader.js";
export { EnvelopeLayout } from "./envelope/layout.js";
export { ContentTypes } from "./envelope/content-types.js";

export {
  generateKeyPair,
  importPublicKey,
  exportPublicKey,
  exportPublicKeyBytes,
  importPrivateKey,
  exportPrivateKey,
  deriveSharedSecret,
  isClampedX25519Scalar,
  clampX25519Scalar,
} from "./crypto/x25519.js";

export { encryptAesGcm, decryptAesGcm } from "./crypto/aes-gcm.js";
export { deriveAesKey, deriveHmacKey } from "./crypto/kdf.js";
export { hmacSha256, verifyHmacSha256 } from "./crypto/hmac.js";
export { sha256 } from "./crypto/hash.js";
export { randomBytes, randomIV } from "./crypto/random.js";
export { cryptoSupport } from "./crypto/support.js";

export { bytesToHex, hexToBytes } from "./encoding/hex.js";
export {
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  base64UrlToBytes,
} from "./encoding/base64.js";
export { encodeUtf8, decodeUtf8 } from "./encoding/utf8.js";

export { insist } from "./util/util.js";
