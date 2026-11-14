/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { DispatchError, RelayThrottledError } from "../../index.js";
import { formatTime } from "./format.js";

const isThrottle = ({ error }) => error instanceof RelayThrottledError;

const untilTime = ({ error }, now) => formatTime(error.throttledUntil, now);

function reason(failure, now) {

  if (isThrottle(failure)) {
    return `rate limited until ${untilTime(failure, now)}`;
  }

  return failure.error?.message ?? String(failure.error);
}

// The text for a send() that rejected.
export function describeSendFailure(error, now = Date.now()) {

  if (!(error instanceof DispatchError) || error.failed.length === 0) {
    return error.message;
  }

  if (error.failed.length === 1 && isThrottle(error.failed[0])) {

    const [failure] = error.failed;

    return `Not sent. ${failure.relayUrl} is rate limiting you until ${untilTime(failure, now)}.`;
  }

  const relays = error.failed
    .map(failure => `${failure.relayUrl}: ${reason(failure, now)}`)
    .join("; ");

  return `Not sent. ${relays}.`;
}

// The text for a send() that at least one relay accepted.
export function describeSendResult({ delivered, failed }, now = Date.now()) {

  const sent = `Sent to ${delivered.length} of ${delivered.length + failed.length} relays.`;

  const throttled = failed
    .filter(isThrottle)
    .map(failure => ` ${failure.relayUrl} is rate limiting you until ${untilTime(failure, now)}.`);

  return sent + throttled.join("");
}
