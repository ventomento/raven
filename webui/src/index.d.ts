/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { RelayInput, Storage } from "../../smerp/src/index.js";

export const UnsupportedReasons: Readonly<{
  INSECURE_CONTEXT: "insecure-context";
  NO_CRYPTO: "no-crypto";
  NO_STORAGE: "no-storage";
}>;

export type UnsupportedReason = (typeof UnsupportedReasons)[keyof typeof UnsupportedReasons];

export class UnsupportedBrowserError extends Error {
  constructor(reason: UnsupportedReason);
  reason: UnsupportedReason;
}

/** `indexedDb: false` skips the storage probe, for a UI given its own storage. */
export function browserSupport(options?: {
  indexedDb?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: UnsupportedReason; message: string }>;

export interface WebUiOptions {
  privateKeyHex: string;
  /** Defaults to `document.body`. */
  root?: HTMLElement;
  /** Defaults to an `IndexedDbStorage` named after the public key. */
  storage?: Storage | null;
  /** Opens the Send view prefilled. */
  recipientPublicKeyHex?: string | null;
  /** Added unless already stored. `relayType` defaults to `"relay"`. */
  relays?: Array<Pick<RelayInput, "relayUrl"> & Partial<Pick<RelayInput, "relayType" | "relayPkh">>>;
  debug?: boolean;
  notify?: boolean;
  ntfyUrl?: string | null;
}

export class WebUi {
  constructor(options: WebUiOptions);
  /** Rejects with `UnsupportedBrowserError` if the browser can't run it. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Deletes every IndexedDB database of the origin and leaves a notice in place of the UI. */
  deleteBrowserData(): Promise<void>;
}
