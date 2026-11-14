/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { insist } from "../../../smep/src/internal.js";
import { RealClock } from "../lib/clock.js";
import { TokenBucket } from "../lib/token-bucket.js";
import { normalizePkh } from "../auth/request-signer.js";
import {
    SmerpHeaders,
    Status,
    decodeBatch,
    parseCursor,
    parseEpoch,
    parseRetryAfter,
} from "../protocol/index.js";
import { RelayThrottledError } from "../client/errors.js";
import { RequestBuilder } from "./request-builder.js";

export class RelaySession {

    static DEFAULTS = Object.freeze({
        ratePerSecond: 2,
        burst: 3,
        backoffBaseMs: 30 * 1000,
        backoffMaxMs: 60 * 60 * 1000,
        defaultThrottleMs: 5 * 1000,
        shortThrottleMs: 10 * 1000,
        throttleChainGapMs: 2 * 60 * 1000,
    });

    static backoffMs(failureCount) {

        const { backoffBaseMs, backoffMaxMs } = RelaySession.DEFAULTS;

        return Math.min(backoffBaseMs * 2 ** (failureCount - 1), backoffMaxMs);
    }

    constructor({
        relay,
        identity,
        transporter,
        consume,
        save,
        logger,
        clock = RealClock,
        ratePerSecond = RelaySession.DEFAULTS.ratePerSecond,
        burst = RelaySession.DEFAULTS.burst,
    }) {

        insist(relay.relayUrl, "string");
        insist(transporter);
        insist(consume, "function");
        insist(save, "function");
        insist(logger);

        this.transporter = transporter;
        this.consume = consume;
        this.save = save;
        this.logger = logger;
        this.clock = clock;
        this.bucket = new TokenBucket({ ratePerSecond, burst, clock });

        this.relayUrl = relay.relayUrl;
        this.requestBuilder = new RequestBuilder({
            relayUrl: relay.relayUrl,
            identity,
            clock,
        });

        this.cursor = relay.cursor ?? 0;
        this.epoch = relay.epoch ?? null;
        this.relayPkh = relay.relayPkh ?? null;
        this.failureCount = relay.failureCount ?? 0;
        this.lastSuccessAt = relay.lastSuccessAt ?? null;
        this.lastFailureAt = relay.lastFailureAt ?? null;
        this.lastFailureReason = relay.lastFailureReason ?? null;
        this.throttledUntil = relay.throttledUntil ?? 0;
        this.throttledSince = relay.throttledSince ?? null;
    }

    state() {

        return {
            cursor: this.cursor,
            epoch: this.epoch,
            relayPkh: this.relayPkh,
            failureCount: this.failureCount,
            lastSuccessAt: this.lastSuccessAt,
            lastFailureAt: this.lastFailureAt,
            lastFailureReason: this.lastFailureReason,
            throttledUntil: this.throttledUntil,
            throttledSince: this.throttledSince,
        };
    }

    // The next token, and a throttle only when it is about to end: a session
    // waits that out in the same sync. A longer one must stay out of here, or
    // a relay throttling for an hour would hold a sync open.
    notBefore() {

        const tokenAt = this.bucket.nextTokenAt();

        return this.isShortThrottle() ? Math.max(tokenAt, this.throttledUntil) : tokenAt;
    }

    isShortThrottle() {

        const remaining = this.throttledUntil - this.clock.now();

        return remaining > 0 && remaining <= RelaySession.DEFAULTS.shortThrottleMs;
    }

    async step() {
        const now = this.clock.now();

        if (now < this.backoffUntil() || now < this.throttledUntil) {
            this.logger.debug("waiting", { backoffUntil: this.backoffUntil(), throttledUntil: this.throttledUntil });
            return false;
        }

        if (!this.bucket.tryTake()) {
            return true;
        }

        const more = await this.fetchBatch();

        await this.save(this.state());

        return more;
    }

    async fetchBatch() {

        const requested = this.cursor;
        const request = await this.requestBuilder.buildGet(requested, this.relayPkh);

        let response;

        try {
            response = await this.transporter.transport(request);
        }
        catch (error) {
            this.recordFailure(error.message);
            return false;
        }

        const relayKeyChanged = this.adoptRelayPkh(response);

        if (this.adoptEpoch(response)) {
            return response.status === Status.TOO_MANY_REQUESTS ? this.recordThrottle(response) : true;
        }

        switch (response.status) {

            case Status.OK:
                this.throttledSince = null;
                return this.consumeBatch(response, requested);

            case Status.NO_CONTENT:
                this.throttledSince = null;
                this.logger.debug("caught up", { cursor: requested });
                this.recordSuccess();
                return false;

            case Status.UNAUTHORIZED:
                if (relayKeyChanged) {
                    this.recordSuccess();
                    return true;
                }
                this.recordFailure(unauthorizedReason(response));
                return false;

            case Status.TOO_MANY_REQUESTS:
                return this.recordThrottle(response);

            default:
                this.recordFailure(`unexpected status ${response.status}`);
                return false;
        }
    }

    async consumeBatch(response, requested) {

        let cursor;

        try {
            cursor = parseCursor(response.headers?.[SmerpHeaders.cursor], requested);
        }
        catch (error) {
            this.recordFailure(error.message);
            return false;
        }

        const { frames, error } = decodeBody(response.body);

        await this.consume(frames);

        this.cursor = cursor;

        this.logger.debug("batch", { from: requested, to: cursor, frames: frames.length });

        if (error) {
            this.recordFailure(error);
            return false;
        }

        this.recordSuccess();
        return true;
    }

    async post(envelopeBytes) {

        if (this.clock.now() < this.throttledUntil) {
            throw new RelayThrottledError(this.relayUrl, this.throttledUntil);
        }

        const request = await this.requestBuilder.buildPost(envelopeBytes, this.relayPkh);
        const response = await this.transporter.transport(request);

        const relayKeyChanged = this.adoptRelayPkh(response);

        const throttled = response.status === Status.TOO_MANY_REQUESTS;
        const throttleCleared = response.status === Status.OK && this.throttledSince !== null;

        if (throttled) {
            this.recordThrottle(response);
        }

        if (throttleCleared) {
            this.throttledSince = null;
        }

        if (relayKeyChanged || throttled || throttleCleared) {
            await this.save(this.state());
        }

        switch (response.status) {

            case Status.OK:
                return;

            case Status.TOO_MANY_REQUESTS:
                throw new RelayThrottledError(this.relayUrl, this.throttledUntil);

            default: {
                const reason = response.headers?.[SmerpHeaders.unauthorized];
                throw new Error(
                    `Relay dispatch failed: ${response.status}` +
                    (typeof reason === "string" ? ` (${reason})` : "") +
                    (relayKeyChanged ? " (relay key learned, send again)" : "")
                );
            }
        }
    }

    // Returns true when the wait is short enough to sit out in the same sync.
    // throttledSince marks the start of an unbroken run of 429s, so repeated
    // short waits can add up to a long block. A run ends on a 200 or 204, or
    // when too long passed since the last wait ended: the client was away, not
    // refused all that time.
    recordThrottle(response) {

        const now = this.clock.now();
        const value = response.headers?.[SmerpHeaders.retryAfter];
        const seconds = parseRetryAfter(value);

        if (seconds === null) {
            this.logger.warn("invalid retry-after", { value });
        }

        const waitMs = seconds === null ? RelaySession.DEFAULTS.defaultThrottleMs : seconds * 1000;

        if (this.throttledSince === null || now - this.throttledUntil > RelaySession.DEFAULTS.throttleChainGapMs) {
            this.throttledSince = now;
        }

        this.throttledUntil = Math.max(this.throttledUntil, now + waitMs);

        this.logger.info("throttled by relay", { waitMs });

        return this.throttledUntil - now <= RelaySession.DEFAULTS.shortThrottleMs;
    }

    adoptRelayPkh(response) {

        const value = response.headers?.[SmerpHeaders.relayPkh];
        const relayPkh = normalizePkh(value);

        if (!relayPkh) {
            if (value !== undefined) {
                this.logger.warn("invalid relay pkh", { value });
            }
            return false;
        }

        const changed = relayPkh !== this.relayPkh;
        this.relayPkh = relayPkh;

        if (changed) {
            this.logger.info("relay key learned", { relayPkh });
        }

        return changed;
    }

    // A new epoch means the relay's cursors started over (its storage was
    // reset), so ours points into a cursor space that no longer exists: start
    // again from 0, ignoring this response, which answered the old cursor.
    // Dedup by hash makes the refetch safe. Returns true on such a reset. A
    // first epoch is only stored; a missing one changes nothing.
    adoptEpoch(response) {

        const value = response.headers?.[SmerpHeaders.epoch];
        const epoch = parseEpoch(value);

        if (!epoch) {
            if (value !== undefined) {
                this.logger.warn("invalid relay epoch", { value });
            }
            return false;
        }

        if (this.epoch === null) {
            this.epoch = epoch;
            this.logger.debug("relay epoch learned", { epoch });
            return false;
        }

        if (epoch === this.epoch) {
            return false;
        }

        this.logger.info("relay epoch changed, cursor reset", { from: this.cursor, epoch });

        this.epoch = epoch;
        this.cursor = 0;

        return true;
    }

    backoffUntil() {

        if (this.failureCount === 0) {
            return 0;
        }

        return this.lastFailureAt + RelaySession.backoffMs(this.failureCount);
    }

    recordSuccess() {
        this.failureCount = 0;
        this.lastSuccessAt = this.clock.now();
        this.lastFailureReason = null;
    }

    recordFailure(reason) {

        this.failureCount += 1;
        this.lastFailureAt = this.clock.now();
        this.lastFailureReason = reason;

        this.logger.warn("relay failure", { reason, failureCount: this.failureCount });
    }
}

function decodeBody(body) {

    if (!(body instanceof Uint8Array || body instanceof ArrayBuffer)) {
        return { frames: [], error: "relay returned a non-binary body" };
    }

    return decodeBatch(body);
}

function unauthorizedReason(response) {

    const reason = response.headers?.[SmerpHeaders.unauthorized];

    return typeof reason === "string" ? `unauthorized: ${reason}` : "unauthorized";
}
