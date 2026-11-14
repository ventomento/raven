/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const RealClock = Object.freeze({
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    timer: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
    },
});
