import { insist } from "../../../smep/src/util/util.js";
import { RealClock } from "../lib/clock.js";
import { TokenBucket } from "../lib/token-bucket.js";
import { normalizePkh } from "../auth/request-signer.js";
import {
    SmerpHeaders,
    Status,
    decodeBatch,
    parseCursor,
} from "../protocol/index.js";
import { RequestBuilder } from "./request-builder.js";

/**
 * Talks to one relay: fetches its batches and keeps everything about that
 * relay (cursor, relay key, health, rate limit). Implements what the
 * Scheduler (sync/scheduler.js) needs: step() and notBefore().
 *
 * Config (relayUrl, relayToken) is fixed for the session's lifetime: on a
 * relay change the caller builds a new session from the stored record.
 * The token bucket lives here too, so it starts full with every session.
 *
 * A RequestBuilder builds each signed request, the transporter sends it,
 * the session interprets the response.
 *
 * Injected, beside the stored relay record:
 *
 *   identity      PrivateIdentity of this client; requests are signed with it
 *   transporter   { transport({ url, options, timeout, logger }) → { status, headers, body } }
 *                 (transport/transport-interface.js)
 *   consume       (frames) → Promise. Handles a batch's envelopes (each an
 *                 ArrayBuffer). Throws only on a local fault (storage):
 *                 the cursor then stays and the relay is not blamed.
 *   save          (state) → Promise. Persists state() after each request.
 */
export class RelaySession {

    static DEFAULTS = Object.freeze({
        ratePerSecond: 2,
        burst: 3,
        backoffBaseMs: 30 * 1000,
        backoffMaxMs: 60 * 60 * 1000,
    });

    // Wait after failureCount failures in a row: 30 s, 60 s, 2 min, ... 1 h.
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
        this.pausedUntil = 0;   // a 429's Retry-After; in memory only

        // Config
        this.relayUrl = relay.relayUrl;
        this.requestBuilder = new RequestBuilder({
            relayUrl: relay.relayUrl,
            relayToken: relay.relayToken ?? null,
            identity,
            clock,
        });

        // State, persisted through save
        this.cursor = relay.cursor ?? 0;
        this.relayPkh = relay.relayPkh ?? null;
        this.failureCount = relay.failureCount ?? 0;
        this.lastSuccessAt = relay.lastSuccessAt ?? null;
        this.lastFailureAt = relay.lastFailureAt ?? null;
        this.lastFailureReason = relay.lastFailureReason ?? null;
    }

    state() {

        return {
            cursor: this.cursor,
            relayPkh: this.relayPkh,
            failureCount: this.failureCount,
            lastSuccessAt: this.lastSuccessAt,
            lastFailureAt: this.lastFailureAt,
            lastFailureReason: this.lastFailureReason,
        };
    }

    // =====================================================
    // Scheduler contract
    // =====================================================

    // Time of the next rate-limit token. Backoff and 429 pauses are not
    // in here: step() declines while they last.
    notBefore() {
        return this.bucket.nextTokenAt();
    }

    /**
     * One GET /envelopes. Resolves true if there is more to fetch right
     * away, false when caught up, failed or throttled. Rejects if consume
     * or save throws; the cursor then stays where it was.
     */
    async step() {

        // Backing off after failures, or told to wait by a 429: no
        // request; a later sync tries again.
        const now = this.clock.now();

        if (now < this.backoffUntil() || now < this.pausedUntil) {
            return false;
        }

        // The token went elsewhere since we were queued: no request, the
        // scheduler waits for notBefore().
        if (!this.bucket.tryTake()) {
            return true;
        }

        const more = await this.fetchBatch();

        await this.save(this.state());

        return more;
    }

    // =====================================================
    // GET /envelopes
    // =====================================================

    async fetchBatch() {

        const requested = this.cursor;
        const request = await this.requestBuilder.buildGet(requested, this.relayPkh);

        let response;

        try {
            response = await this.transporter.transport({ ...request, logger: this.logger });
        }
        catch (error) {
            this.recordFailure(error.message);
            return false;
        }

        const relayKeyChanged = this.adoptRelayPkh(response);

        switch (response.status) {

            case Status.OK:
                return this.consumeBatch(response, requested);

            case Status.NO_CONTENT:
                this.recordSuccess();
                return false;

            case Status.UNAUTHORIZED:
                // Unsigned, or signed with a key the relay no longer has:
                // the response taught us its key. Not a failure; the next
                // request is signed with it (auth_rfc section 7).
                if (relayKeyChanged) {
                    this.recordSuccess();
                    return true;
                }
                this.recordFailure(unauthorizedReason(response));
                return false;

            case Status.TOO_MANY_REQUESTS:
                this.pauseForRetryAfter(response);
                return false;

            default:
                this.recordFailure(`unexpected status ${response.status}`);
                return false;
        }
    }

    // A batch with a valid cursor always moves the cursor, even if its
    // framing breaks partway: the frames before the break are consumed,
    // so a broken batch cannot stall the mailbox (smerp_rfc section 4).
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

        // Throws on a local fault: the cursor stays, nothing is recorded.
        await this.consume(frames);

        this.cursor = cursor;

        if (error) {
            this.recordFailure(error);
            return false;
        }

        this.recordSuccess();
        return true;
    }

    // =====================================================
    // POST /envelopes
    // =====================================================

    /**
     * Upload one envelope. Resolves on 200, throws otherwise. Used for
     * sends, outside the scheduler: it takes no token, so a send is not
     * held up by the sync budget, but it fails fast while the relay has
     * asked us to wait (429). Health is not touched: one refused
     * envelope says nothing about syncing.
     */
    async post(envelopeBytes) {

        if (this.clock.now() < this.pausedUntil) {
            throw new Error(`Relay asked to wait: ${this.relayUrl}`);
        }

        const request = await this.requestBuilder.buildPost(envelopeBytes, this.relayPkh);
        const response = await this.transporter.transport({ ...request, logger: this.logger });

        const relayKeyChanged = this.adoptRelayPkh(response);

        if (relayKeyChanged) {
            await this.save(this.state());
        }

        switch (response.status) {

            case Status.OK:
                return;

            case Status.TOO_MANY_REQUESTS:
                this.pauseForRetryAfter(response);
                throw new Error(`Relay asked to wait: ${this.relayUrl}`);

            // A 401 that taught a new key is not retried: the next post is
            // signed with it.
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

    // Retry-After in seconds; missing or unreadable waits 5 s. Holds back
    // sync steps and posts alike.
    pauseForRetryAfter(response) {

        const seconds = Number(response.headers?.[SmerpHeaders.retryAfter]);
        const waitMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5000;

        this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + waitMs);
    }

    // =====================================================
    // Relay key
    // =====================================================

    // Adopt a valid x-smerp-relay-pkh; returns true if it differs from the
    // known key. A missing or malformed one (e.g. a proxy's error page)
    // keeps the known key. A changed key means the request was signed with
    // another key, or unsigned. (A post adopting a key while a step is in
    // flight can make that step miss it; the step then counts one failure
    // and its next request is signed with the new key.)
    adoptRelayPkh(response) {

        const value = response.headers?.[SmerpHeaders.relayPkh];
        const relayPkh = normalizePkh(value);

        if (!relayPkh) {
            if (value !== undefined) {
                this.logger.warn(`Invalid relay pkh from ${this.relayUrl}: ${value}`);
            }
            return false;
        }

        const changed = relayPkh !== this.relayPkh;
        this.relayPkh = relayPkh;

        return changed;
    }

    // =====================================================
    // Health
    // =====================================================

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

    // The reason is shown to the user as lastFailureReason.
    recordFailure(reason) {

        this.logger.warn(`Relay failure: ${this.relayUrl}: ${reason}`);

        this.failureCount += 1;
        this.lastFailureAt = this.clock.now();
        this.lastFailureReason = reason;
    }
}

// A body that is not bytes is a batch with no readable frame.
function decodeBody(body) {

    if (!(body instanceof Uint8Array || body instanceof ArrayBuffer)) {
        return { frames: [], error: "relay returned a non-binary body" };
    }

    return decodeBatch(body);
}

// The relay's reason is untrusted text, kept for display only.
function unauthorizedReason(response) {

    const reason = response.headers?.[SmerpHeaders.unauthorized];

    return typeof reason === "string" ? `unauthorized: ${reason}` : "unauthorized";
}
