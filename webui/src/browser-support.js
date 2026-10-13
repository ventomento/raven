// webui/src/browser-support.js
//
// Whether this browser can run the web UI, with a message for the user
// when it cannot. Feature tests only, no browser sniffing. DOM-free.

import { cryptoSupport } from "../../smep/src/index.js";

const PROBE_DATABASE = "smerp-support-probe";

export const UnsupportedReasons = Object.freeze({
  INSECURE_CONTEXT: "insecure-context",
  NO_CRYPTO: "no-crypto",
  NO_STORAGE: "no-storage",
});

const MESSAGES = Object.freeze({
  [UnsupportedReasons.INSECURE_CONTEXT]:
    "This page must be opened over HTTPS (or from localhost): browsers " +
    "only provide the encryption this app needs on secure pages.",
  [UnsupportedReasons.NO_CRYPTO]:
    "Your browser doesn't support the encryption this app needs (X25519). " +
    "Update your browser, or use a current version of Firefox, Chrome, " +
    "Edge, Brave or Safari.",
  [UnsupportedReasons.NO_STORAGE]:
    "Your browser doesn't let this page store data, which this app needs. " +
    "Private or Tor windows and strict privacy settings can block it: try " +
    "a normal window, or allow site data for this page.",
});

// Thrown by WebUi.start() in a browser that cannot run it. The message is
// meant for the user.
export class UnsupportedBrowserError extends Error {
  constructor(reason) {
    super(MESSAGES[reason]);
    this.name = "UnsupportedBrowserError";
    this.reason = reason;
  }
}

/**
 * Resolves { ok: true } or { ok: false, reason, message }, reason one of
 * UnsupportedReasons. indexedDb: also check that IndexedDB opens (the
 * default storage). Never rejects.
 */
export async function browserSupport({ indexedDb = true } = {}) {

  const crypto = await cryptoSupport();

  if (!crypto.ok) {
    // Browsers hide crypto.subtle outside secure contexts (plain http
    // other than localhost): that needs another fix than an update.
    return unsupported(globalThis.isSecureContext === false
      ? UnsupportedReasons.INSECURE_CONTEXT
      : UnsupportedReasons.NO_CRYPTO);
  }

  if (indexedDb && !await indexedDbOpens()) {
    return unsupported(UnsupportedReasons.NO_STORAGE);
  }

  return { ok: true };
}

function unsupported(reason) {
  return { ok: false, reason, message: MESSAGES[reason] };
}

// Open and delete a throwaway database. Missing, throwing or failing all
// mean storage is unavailable.
function indexedDbOpens() {

  return new Promise(resolve => {

    let request;

    try {
      request = globalThis.indexedDB.open(PROBE_DATABASE);
    }
    catch {
      resolve(false);
      return;
    }

    request.onsuccess = () => {
      request.result.close();
      globalThis.indexedDB.deleteDatabase(PROBE_DATABASE);
      resolve(true);
    };

    request.onerror = () => resolve(false);
  });
}
