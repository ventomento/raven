/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export class SmerpError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotStartedError extends SmerpError {
  constructor() {
    super("smerp client not started");
  }
}

export class DispatchError extends SmerpError {
  constructor(failed) {
    super(
      failed.length === 0
        ? "no relays configured"
        : `dispatch failed to all ${failed.length} relays`
    );
    this.failed = failed;
  }
}

// A relay answered 429, or did earlier and its wait is not over. Found in the
// failed list of send() and DispatchError.
export class RelayThrottledError extends SmerpError {
  constructor(relayUrl, throttledUntil) {
    super(`Relay asked to wait until ${new Date(throttledUntil).toISOString()}: ${relayUrl}`);
    this.relayUrl = relayUrl;
    this.throttledUntil = throttledUntil;
  }
}
