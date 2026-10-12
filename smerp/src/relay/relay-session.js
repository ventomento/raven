import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { RequestSigner, normalizePkh } from "../auth/request-signer.js";
import { TokenBucket } from "../lib/token-bucket.js";
import { RealClock } from "../lib/clock.js";
import {
    SmerpHeaders,
    Status,
    MAX_BATCH_BYTES,
    getEnvelopes,
    postEnvelope,
    decodeBatch,
    parseCursor,
    retryAfterMs,
} from "../protocol/index.js";

// What get() reports to the pool.
export const SessionOutcome = Object.freeze({
    MORE: "more",            // a batch was processed, there may be more
    EMPTY: "empty",          // 204: the mailbox is caught up
    THROTTLED: "throttled",  // 429: the bucket is paused until Retry-After
    FAILURE: "failure",      // the relay failed; counted, backs off
    ERROR: "error",          // consume threw (local, e.g. storage); not counted
});

/**
 * Talks to one relay. In memory only: what must survive a restart
 * (cursor, relay key, health) is reported through onChange(state) and
 * persisted by the caller; the token bucket is passed in so it can
 * outlive the session.
 *
 * get(consume) and post(bytes) each switch on the HTTP status directly.
 * exchange() does what every request needs: signing, the access token,
 * learning the relay key and the single retry of auth_rfc section 7.
 *
 * The session never waits for its own rate limit or backoff: the caller
 * checks notBefore() and takes a token before calling get or post.
 */
export class RelaySession {

    static DEFAULTS = Object.freeze({
        backoffBaseMs: 30 * 1000,
        backoffMaxMs: 60 * 60 * 1000,
        // Request timeout: a base plus one second per 256 KiB moved.
        timeoutBaseMs: 10 * 1000,
        timeoutBytesPerSecond: 256 * 1024,
    });

    /**
     * Wait before retrying a relay after failureCount consecutive
     * failures: 30s, 60s, 2m, ... capped at 1h.
     */
    static backoffMs(failureCount) {

        const { backoffBaseMs, backoffMaxMs } = RelaySession.DEFAULTS;

        return Math.min(
            backoffBaseMs * 2 ** (failureCount - 1),
            backoffMaxMs
        );
    }

    static timeoutMs(bytes) {

        const { timeoutBaseMs, timeoutBytesPerSecond } = RelaySession.DEFAULTS;

        return timeoutBaseMs + Math.ceil(bytes / timeoutBytesPerSecond) * 1000;
    }

    constructor({
        relay,
        identity,
        transporter,
        logger,
        bucket,
        clock = RealClock,
        onChange = async () => {},
    }) {

        insist(relay.relayUrl, "string");
        insist(identity, PrivateIdentity);
        insist(transporter);
        insist(logger);
        insist(bucket, TokenBucket);
        insist(onChange, "function");

        this.relayUrl = relay.relayUrl;
        this.identity = identity;
        this.transporter = transporter;
        this.logger = logger;
        this.bucket = bucket;
        this.clock = clock;
        this.onChange = onChange;

        // Sync state, loaded once; from here on the session owns it.
        this.cursor = relay.cursor ?? 0;
        this.relayPkh = relay.relayPkh ?? null;
        this.failureCount = relay.failureCount ?? 0;
        this.lastSuccessAt = relay.lastSuccessAt ?? null;
        this.lastFailureAt = relay.lastFailureAt ?? null;
        this.lastFailureReason = relay.lastFailureReason ?? null;

        this.signers = new Map(); // relayPkh -> RequestSigner

        this.configure(relay);
    }

    // Take the user-owned config fields the session uses.
    configure(relay) {
        this.relayToken = relay.relayToken ?? null;
    }

    // The sync fields to persist.
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
    // Timing
    // =====================================================

    // Earliest time this relay may be asked again: the latest of the next
    // token, the end of a 429 pause, and the end of failure backoff.
    notBefore() {
        return Math.max(this.bucket.nextTokenAt(), this.backoffUntil());
    }

    backoffUntil() {

        if (this.failureCount === 0) {
            return 0;
        }

        return (this.lastFailureAt ?? 0) + RelaySession.backoffMs(this.failureCount);
    }

    // Asked to wait by the relay (429).
    isThrottled() {
        return this.bucket.isPaused();
    }

    // =====================================================
    // GET /envelopes
    // =====================================================

    /**
     * Fetch the next batch and hand it to consume(frames, cursor). The
     * cursor advances only once consume resolved. Resolves with
     * { outcome, error? }; error is set whenever something went wrong,
     * even if the outcome is MORE (a broken batch that was skipped).
     */
    async get(consume) {

        const requested = this.cursor;

        let response;

        try {
            response = await this.exchange(
                getEnvelopes(requested),
                RelaySession.timeoutMs(MAX_BATCH_BYTES)
            );
        }
        catch (error) {
            return this.#failure(error.message);
        }

        switch (response.status) {

            case Status.OK:
                return this.#onBatch(response, requested, consume);

            case Status.NO_CONTENT:
                await this.#succeeded();
                return { outcome: SessionOutcome.EMPTY };

            case Status.UNAUTHORIZED:
                return this.#failure(unauthorizedReason(response));

            case Status.TOO_MANY_REQUESTS:
                this.#throttle(response);
                return { outcome: SessionOutcome.THROTTLED };

            default:
                return this.#failure(`unsupported response status ${response.status}`);
        }
    }

    async #onBatch(response, requested, consume) {

        let cursor;

        try {
            cursor = parseCursor(response.headers?.[SmerpHeaders.cursor], requested);
        }
        catch (error) {
            // No safe position to move to: keep the cursor, back off.
            return this.#failure(error.message);
        }

        // With a valid cursor a broken batch is skipped past, keeping the
        // frames before the break, so it cannot stall the mailbox. Serving
        // it still counts against the relay.
        const { frames, error } = decodeBody(response.body);

        try {
            await consume(frames, cursor);
        }
        catch (error) {
            // Local fault: keep the cursor so the batch is fetched again,
            // and do not count it against the relay.
            return { outcome: SessionOutcome.ERROR, error };
        }

        this.cursor = cursor;

        if (error) {
            return { ...(await this.#failure(error)), outcome: SessionOutcome.MORE };
        }

        await this.#succeeded();

        return { outcome: SessionOutcome.MORE };
    }

    // =====================================================
    // POST /envelopes
    // =====================================================

    /**
     * Upload an envelope. Resolves on 200, throws otherwise. Relay health
     * is not touched: one refused envelope says nothing about syncing.
     */
    async post(envelopeBytes) {

        const response = await this.exchange(
            postEnvelope(envelopeBytes),
            RelaySession.timeoutMs(envelopeBytes.byteLength)
        );

        switch (response.status) {

            case Status.OK:
                return;

            case Status.TOO_MANY_REQUESTS:
                this.#throttle(response);
                throw new Error(`Relay asked to wait: ${this.relayUrl}`);

            default: {
                const reason = response.headers?.[SmerpHeaders.unauthorized];
                throw new Error(
                    `Relay dispatch failed: ${response.status}` +
                    (typeof reason === "string" ? ` (${reason})` : "")
                );
            }
        }
    }

    // =====================================================
    // Exchange: auth for every request
    // =====================================================

    /**
     * request: { method, target, body?, headers? } (see protocol/requests.js)
     * Returns the transport response { status, headers, body }.
     *
     * Signed with relayPkh, unsigned while none is known. A response's
     * x-smerp-relay-pkh is adopted; a 401 carrying a key other than the
     * one the request was signed with is retried once, which covers first
     * contact and key rotation.
     */
    async exchange(request, timeout) {

        const signedWith = this.relayPkh;

        let response = await this.#send(request, timeout);

        const relayPkh = await this.#learnRelayPkh(response);

        if (
            response.status === Status.UNAUTHORIZED &&
            relayPkh !== null &&
            relayPkh !== signedWith
        ) {
            response = await this.#send(request, timeout);
            await this.#learnRelayPkh(response);
        }

        return response;
    }

    async #send({ method, target, body, headers = {} }, timeout) {

        return this.transporter.transport({
            url: `${this.relayUrl}${target}`,
            options: {
                method,
                headers: {
                    ...headers,
                    ...(await this.#signatureHeaders({ method, target, body })),
                    ...(this.relayToken && { authorization: `Bearer ${this.relayToken}` }),
                },
                ...(body !== undefined && { body }),
            },
            timeout,
            logger: this.logger,
        });
    }

    async #signatureHeaders(request) {

        if (!this.relayPkh) {
            return {};
        }

        let signer = this.signers.get(this.relayPkh);

        if (!signer) {
            signer = new RequestSigner({
                identity: this.identity,
                relayPkh: this.relayPkh,
                clock: this.clock,
            });
            this.signers.set(this.relayPkh, signer);
        }

        return signer.headers(request);
    }

    // Returns the pkh the response announced, or null if it carried none
    // or a malformed one (e.g. a proxy's error page): the known pkh stays.
    async #learnRelayPkh(response) {

        const value = response.headers?.[SmerpHeaders.relayPkh];
        const relayPkh = normalizePkh(value);

        if (!relayPkh) {
            if (value !== undefined) {
                this.logger.warn(`Invalid relay pkh received: ${value}`);
            }
            return null;
        }

        if (relayPkh !== this.relayPkh) {
            this.relayPkh = relayPkh;
            await this.onChange(this.state());
        }

        return relayPkh;
    }

    // =====================================================
    // Health
    // =====================================================

    async #succeeded() {

        this.lastSuccessAt = this.clock.now();
        this.failureCount = 0;
        this.lastFailureReason = null;

        await this.onChange(this.state());
    }

    // The reason is shown to the user as lastFailureReason.
    async #failure(reason) {

        this.logger.warn(`Relay failure: ${this.relayUrl}: ${reason}`);

        this.failureCount += 1;
        this.lastFailureAt = this.clock.now();
        this.lastFailureReason = reason;

        await this.onChange(this.state());

        return {
            outcome: SessionOutcome.FAILURE,
            error: new Error(`Relay failure: ${this.relayUrl}: ${reason}`),
        };
    }

    // A 429 counts as neither success nor failure.
    #throttle(response) {

        const now = this.clock.now();

        this.bucket.pause(now + retryAfterMs(response.headers, now));
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
