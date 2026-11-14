/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export class PublicIdentity {
  constructor(publicKey: CryptoKey);
  readonly publicKey: CryptoKey;
  static fromPublicHex(publicKeyHex: string): Promise<PublicIdentity>;
}

export class PrivateIdentity {
  constructor(keys: { privateKey: CryptoKey; publicKey: CryptoKey; publicKeyHex?: string | null });
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly publicKeyHex: string | null;
  static generate(): Promise<PrivateIdentity>;
  static fromPrivateKeyHex(privateKeyHex: string): Promise<PrivateIdentity>;
  exportPrivateHex(): Promise<string>;
  exportPublicHex(): Promise<string>;
  exportPublicBytes(): Promise<Uint8Array>;
}

export const ContentTypes: Readonly<{
  TEXT_UTF8: 0x01;
  IMAGE: 0x02;
  VIDEO: 0x03;
  AUDIO: 0x04;
  FILE: 0x05;
  UNKNOWN: 0xff;
}>;

/** A value of `ContentTypes`, or any other byte a peer put in its envelope. */
export type ContentType = number;

export const EnvelopeLayout: Readonly<{
  VERSION: number;
  HEADER_SIZE: number;
  MAX_SIZE: number;
  SIZES: Readonly<{ PUBKEY: number; NONCE: number; TAG: number; MIN_PAYLOAD: number }>;
}>;

export interface ParsedEnvelope {
  readonly version: number;
  readonly sender_public_key: Uint8Array;
  readonly recipient_public_key: Uint8Array;
  readonly timestamp: bigint;
  readonly content_type: ContentType;
  readonly payload_size: number;
  /** The received header bytes, which authenticate the ciphertext. */
  readonly header: Uint8Array;
  readonly aes_gcm_iv: Uint8Array;
  readonly ciphertext_with_tag: Uint8Array;
}

export interface DecryptedEnvelope {
  readonly senderPublicKeyHex: string;
  readonly recipientPublicKeyHex: string;
  readonly contentType: ContentType;
  /** A string for `ContentTypes.TEXT_UTF8`, bytes for anything else. */
  readonly plaintext: string | Uint8Array;
  /** Seconds since the epoch, as the sender stated it. */
  readonly timestamp: number;
}

export function encrypt(input: {
  sender: PrivateIdentity;
  recipient: PublicIdentity;
  plaintext: string | Uint8Array | ArrayBuffer;
  contentType?: ContentType;
}): Promise<ArrayBuffer>;

export function decrypt(input: {
  identity: PrivateIdentity;
  envelopeBytes: ArrayBuffer;
}): Promise<DecryptedEnvelope>;

export function decryptEnvelope(input: {
  identity: PrivateIdentity;
  envelope: ParsedEnvelope;
}): Promise<DecryptedEnvelope>;

/** Parses without decrypting. Throws on a malformed envelope. */
export function readEnvelope(buffer: ArrayBuffer): ParsedEnvelope;

/** An envelope's identity: the hex SHA-256 of its complete bytes. */
export function envelopeHash(envelopeBytes: ArrayBuffer | Uint8Array): Promise<string>;

/** The ntfy topic for one direction of a conversation. `identity` must be one of the two parties. */
export function notifyTopic(
  identity: PrivateIdentity,
  senderPublicKeyHex: string,
  recipientPublicKeyHex: string,
): Promise<string>;

export function cryptoSupport(): Promise<
  { ok: true } | { ok: false; reason: "no-webcrypto" } | { ok: false; reason: "no-x25519"; error: unknown }
>;
