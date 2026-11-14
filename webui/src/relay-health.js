/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { RelaySession } from "../../smerp/src/index.js";

// How long a relay must have been throttling before the UI says so. Shorter
// waits are normal pacing during a slow sync: they show only in Diagnostics.
export const THROTTLE_PILL_MS = 60 * 1000;
export const THROTTLE_BANNER_MS = 15 * 60 * 1000;

// How long a banner outlives a wait, so a run of short waits doesn't make it
// flicker between one wait's end and the next 429 or the success that clears it.
export const THROTTLE_GRACE_MS = 2 * 60 * 1000;

function throttleSpan(relay) {

  if (relay.throttledSince === null || relay.throttledSince === undefined) {
    return 0;
  }

  return relay.throttledUntil - relay.throttledSince;
}

export function isThrottled(relay, now = Date.now()) {
  return now < (relay.throttledUntil ?? 0);
}

// A relay's health from its stored record (what the session saves after each
// step). DOM-free. retryAt is when the session may send its next request: the
// later of a throttle's end and the failure backoff's end.
export function relayHealth(relay, now = Date.now()) {

  if (relay.disabled) {
    return { state: "disabled", label: "Disabled", retryAt: null };
  }

  const throttled = isThrottled(relay, now);
  const throttleEnd = throttled ? relay.throttledUntil : 0;
  const backoffEnd = relay.failureCount > 0
    ? relay.lastFailureAt + RelaySession.backoffMs(relay.failureCount)
    : 0;
  const end = Math.max(throttleEnd, backoffEnd);
  const retryAt = end > now ? end : null;

  if (throttled && throttleSpan(relay) >= THROTTLE_PILL_MS) {
    return { state: "throttled", label: "Throttled", retryAt };
  }

  if (relay.failureCount > 0) {
    return { state: "failing", label: "Failing", retryAt };
  }

  if (relay.lastSuccessAt) {
    return { state: "ok", label: "Healthy", retryAt };
  }

  return { state: "new", label: "Not synced yet", retryAt };
}

// What the throttle banner shows: enabled relays that have refused service for
// long. Derived from stored fields only, so it survives a reload. dismissed
// holds item keys; a key names one run of 429s, so a dismissal holds while the
// run goes on. allBlocked and blockedUntil ignore dismissals.
export function throttleNotices(relays, dismissed = new Set(), now = Date.now()) {

  const enabled = relays.filter(relay => !relay.disabled);

  const blocked = enabled.filter(relay =>
    throttleSpan(relay) >= THROTTLE_BANNER_MS &&
    now < relay.throttledUntil + THROTTLE_GRACE_MS
  );

  const items = blocked
    .map(relay => ({
      key: `${relay.relayUrl}|${relay.throttledSince}`,
      relayUrl: relay.relayUrl,
      throttledUntil: relay.throttledUntil,
      waiting: isThrottled(relay, now),
    }))
    .filter(item => !dismissed.has(item.key));

  const changes = blocked.map(relay =>
    isThrottled(relay, now) ? relay.throttledUntil : relay.throttledUntil + THROTTLE_GRACE_MS
  );

  return {
    items,
    allBlocked: blocked.length > 0 && blocked.length === enabled.length,
    blockedUntil: blocked.length > 0 ? Math.min(...blocked.map(relay => relay.throttledUntil)) : null,
    nextChangeAt: changes.length > 0 ? Math.min(...changes) : null,
  };
}
