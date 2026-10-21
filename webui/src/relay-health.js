import { RelaySession } from "../../smerp/src/index.js";

// A relay's health from its stored record (what the session saves after each
// step). DOM-free. retryAt is when the session's failure backoff ends: until
// then it sends no requests to the relay. A 429 pause is not stored, so it
// does not show here.
export function relayHealth(relay, now = Date.now()) {

  if (relay.disabled) {
    return { state: "disabled", label: "Disabled", retryAt: null };
  }

  if (relay.failureCount > 0) {

    const retryAt = relay.lastFailureAt + RelaySession.backoffMs(relay.failureCount);

    return { state: "failing", label: "Failing", retryAt: retryAt > now ? retryAt : null };
  }

  if (relay.lastSuccessAt) {
    return { state: "ok", label: "Healthy", retryAt: null };
  }

  return { state: "new", label: "Not synced yet", retryAt: null };
}
