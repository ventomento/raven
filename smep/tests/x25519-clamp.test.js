import test from 'node:test';
import assert from 'node:assert/strict';

import { webcrypto } from 'node:crypto';
import {
  generateKeyPair,
  exportPrivateKey,
  isClampedX25519Scalar
} from "../src/crypto/x25519.js";

import { hexToBytes, bytesToHex } from "../src/encoding/hex.js";

const crypto = webcrypto;

test('exported X25519 private key material is clamped', async () => {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: 'X25519',
    },
    true,
    ['deriveBits']
  );

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey)
  );

  // RFC 8410 PKCS#8 structure:
  //
  // 30 2e
  //   02 01 00
  //   30 05
  //     06 03 2b 65 6e
  //   04 22
  //     04 20
  //       <32 bytes private key material>
  //
  const privateBytes = pkcs8.slice(-32);

  console.log('PKCS8 length:', pkcs8.length);
  console.log('Private bytes:', bytesToHex(privateBytes));

  const clamped = isClampedX25519Scalar(privateBytes);

  console.log('Is clamped:', clamped);

  assert.equal(
    clamped,
    true,
    'Exported private key material is not RFC7748-clamped'
  );
});

test("exportPrivateKey exports a clamped X25519 scalar", async () => {
  const { privateKey } = await generateKeyPair();

  const scalarHex = await exportPrivateKey(privateKey);

  const scalar = hexToBytes(scalarHex);

  console.log("scalar:", scalarHex);
  console.log("first byte:", scalar[0].toString(16));
  console.log("last byte:", scalar[31].toString(16));

  assert.equal(
    scalar.length,
    32,
    "exported scalar should be 32 bytes"
  );

  assert.equal(
    isClampedX25519Scalar(scalar),
    true,
    "exported scalar is not RFC7748-clamped"
  );
});