import { insist } from "../../../smep/src/util/util.js";
import { RealClock } from "../lib/clock.js";
import { TokenBucket } from "../lib/token-bucket.js";
import { normalizePkh } from "../auth/request-signer.js";
import {
    SmerpHeaders,
    Status,
    decodeBatch,
    parseCursor,
    parseEpoch,
} from "../protocol/index.js";
import { RequestBuilder } from "./request-builder.js";

export class RelaySession {

    static DEFAULTS = Object.freeze({
        ratePerSecond: 2,
        burst: 3,
        backoffBaseMs: 30 * 1000,
        backoffMaxMs: 60 * 60 * 1000,
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
        this.pausedUntil = 0;

        this.relayUrl = relay.relayUrl;
        this.requestBuilder = new RequestBuilder({
            relayUrl: relay.relayUrl,
            relayToken: relay.relayToken ?? null,
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
        };
    }

    notBefore() {
        return this.bucket.nextTokenAt();
    }

    async step() {
        const now = this.clock.now();

        if (now < this.backoffUntil() || now < this.pausedUntil) {
            this.logger.debug("waiting", { backoffUntil: this.backoffUntil(), pausedUntil: this.pausedUntil });
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
            return true;
        }

        switch (response.status) {

            case Status.OK:
                return this.consumeBatch(response, requested);

            case Status.NO_CONTENT:
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
                this.pauseForRetryAfter(response);
                return false;

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

        if (this.clock.now() < this.pausedUntil) {
            throw new Error(`Relay asked to wait: ${this.relayUrl}`);
        }

        const request = await this.requestBuilder.buildPost(envelopeBytes, this.relayPkh);
        const response = await this.transporter.transport(request);

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

    pauseForRetryAfter(response) {

        const seconds = Number(response.headers?.[SmerpHeaders.retryAfter]);
        const waitMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 5000;

        this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + waitMs);

        this.logger.info("paused by relay", { waitMs });
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
