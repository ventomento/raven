/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

// A 429's Retry-After (smerp_rfc section 6): a non-negative integer number of
// seconds, capped so a bad value can't block a relay for long once the wait is
// stored. null for anything else, which is the relay's bug.
export function parseRetryAfter(value) {

    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        return null;
    }

    return Math.min(Number(value), MAX_RETRY_AFTER_SECONDS);
}
