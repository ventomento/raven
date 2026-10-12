import { SmerpHeaders } from "./constants.js";

/**
 * Milliseconds to wait from a 429 response's Retry-After header.
 * Accepts delay-seconds or an HTTP date; anything else gets the default.
 */
export function retryAfterMs(headers, now, defaultMs = 5000) {

    const value = headers?.[SmerpHeaders.retryAfter];

    if (value === undefined) {
        return defaultMs;
    }

    if (/^\s*\d+\s*$/.test(value)) {
        return Number(value) * 1000;
    }

    const date = Date.parse(value);

    return Number.isNaN(date)
        ? defaultMs
        : Math.max(0, date - now);
}
