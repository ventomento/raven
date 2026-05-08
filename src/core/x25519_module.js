/**
 * X25519 + AES-GCM utility module
 * Implements key import/export helpers exactly matching your specification.
 *
 * Uses:
 * - X25519 (RFC7748)
 * - Native Web Crypto API
 * - Public keys = 32-byte Montgomery u-coordinate
 * - Private keys = raw 32-byte seed/secret
 *
 * Environment:
 * - Modern browsers
 * - Modern runtimes with WebCrypto support
 */

const X25519_MODULE = (() => {

  // =========================================================
  // Utilities
  // =========================================================

  function hexToBytes(hex) {
    if (typeof hex !== "string") {
      throw new TypeError("Hex input must be a string");
    }

    if (hex.startsWith("0x")) {
      hex = hex.slice(2);
    }

    if (hex.length !== 64) {
      throw new Error("Expected 32-byte hex string (64 hex chars)");
    }

    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error("Invalid hex string");
    }

    const bytes = new Uint8Array(32);

    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
  }

  function bytesToHex(bytes) {
    return [...bytes]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // =========================================================
  // Public Key Import
  // =========================================================
  /**
   * Import X25519 public key from hex string
   *
   * Input:
   * - 32-byte hex Montgomery u-coordinate
   *
   * Returns:
   * - CryptoKey
   */
  async function importPublicKey(publicKeyHex) {

    const raw = hexToBytes(publicKeyHex);

    return await crypto.subtle.importKey(
      "raw",
      raw,
      {
        name: "X25519"
      },
      true,
      []
    );
  }

  // =========================================================
  // Public Key Export
  // =========================================================
  /**
   * Export X25519 public key as hex string
   *
   * Input:
   * - CryptoKey
   *
   * Returns:
   * - 64-char hex string
   */
  async function exportPublicKey(publicKey) {

    const raw = await crypto.subtle.exportKey(
      "raw",
      publicKey
    );

    return bytesToHex(new Uint8Array(raw));
  }

  // =========================================================
  // Private Key Import
  // =========================================================
  /**
   * Import X25519 private key from raw 32-byte seed hex
   *
   * IMPORTANT:
   * Your specification stores the original 32-byte secret.
   * WebCrypto expects PKCS#8 for importing private X25519 keys.
   *
   * Therefore this wraps the raw seed into a PKCS#8 structure.
   */
  async function importPrivateKey(privateSeedHex) {

    const seed = hexToBytes(privateSeedHex);

    // PKCS#8 wrapper for X25519 private key
    // RFC8410 encoding
    //
    // Structure:
    // 302e020100300506032b656e04220420 || 32-byte-seed
    //
    const PKCS8_PREFIX = new Uint8Array([
      0x30, 0x2e,
      0x02, 0x01, 0x00,
      0x30, 0x05,
      0x06, 0x03, 0x2b, 0x65, 0x6e,
      0x04, 0x22,
      0x04, 0x20
    ]);

    const pkcs8 = new Uint8Array(
      PKCS8_PREFIX.length + seed.length
    );

    pkcs8.set(PKCS8_PREFIX, 0);
    pkcs8.set(seed, PKCS8_PREFIX.length);

    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      {
        name: "X25519"
      },
      true,
      ["deriveBits"]
    );
  }

  // =========================================================
  // Private Key Export
  // =========================================================
  /**
   * Export X25519 private key back into raw 32-byte seed hex
   *
   * Returns:
   * - original 32-byte seed hex
   */
  async function exportPrivateKey(privateKey) {

    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey(
        "pkcs8",
        privateKey
      )
    );

    // Last 32 bytes are the raw seed
    const seed = pkcs8.slice(-32);

    return bytesToHex(seed);
  }

  // =========================================================
  // Public API
  // =========================================================

  return {
    importPublicKey,
    exportPublicKey,
    importPrivateKey,
    exportPrivateKey
  };

})();

export default X25519_MODULE;


/* Example Usage:

import X25519_MODULE from "./x25519-module.js";

// Import public key
const publicKey = await X25519_MODULE.importPublicKey(
  "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
);

// Export public key
const publicHex = await X25519_MODULE.exportPublicKey(publicKey);

// Import private seed
const privateKey = await X25519_MODULE.importPrivateKey(
  "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff"
);

// Export private seed
const privateHex = await X25519_MODULE.exportPrivateKey(privateKey);

console.log(publicHex);
console.log(privateHex); 
*/