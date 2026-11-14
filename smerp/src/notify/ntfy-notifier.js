/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { PrivateIdentity, notifyTopic, insist } from "../../../smep/src/internal.js";
import { Logger } from "../log/logger.js";
import { RealClock } from "../lib/clock.js";
import { SmerpHeaders, Status, parseRetryAfter } from "../protocol/index.js";

// The phone notification a sender pushes to ntfy (smerp_rfc section 7).
// It says only how many messages arrived.
const NTFY_PUSH = Object.freeze({
    headers: Object.freeze({ "Title": "raven", "X-Sequence-ID": "raven" }),
    timeout: 5000,
    maxBytes: 64 * 1024,
    defaultPauseMs: 60 * 1000,
});

export function parseNtfyUrl(ntfyUrl) {

    insist(ntfyUrl, "string");

    const url = new URL(ntfyUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("ntfyUrl must be an http(s) URL");
    }

    return ntfyUrl.trim().replace(/\/+$/, "");
}

// Batches pushes per peer. The first message of a burst pushes at once and
// opens a window; later ones are only counted. When a window ends with messages
// counted, one push carries the burst's total and opens the next window; when
// it ends with none, the burst is over and the peer's entry is dropped. So a
// peer gets at most one push per window, and state exists only for active peers.
//
// The total is cumulative for the burst because X-Sequence-ID makes each push
// replace the previous one on the phone.
//
// Everything is in memory and best effort: a timeout, no retry, nothing thrown.
// A failed push is not sent again, but its messages stay in the total of the
// burst's next push. On 429 they stay counted and go out when the pause is over.
// The topic is a secret: it is never logged.
export class NtfyNotifier {

    static DEFAULTS = Object.freeze({ windowMs: 3 * 60 * 1000 });

    constructor({
        identity,
        transporter,
        ntfyUrl = "https://ntfy.sh",
        clock = RealClock,
        logger = new Logger(),
        windowMs = NtfyNotifier.DEFAULTS.windowMs,
    }) {

        insist(identity, PrivateIdentity);
        insist(transporter);
        insist(windowMs, "number");

        this.identity = identity;
        this.transporter = transporter;
        this.ntfyUrl = parseNtfyUrl(ntfyUrl);
        this.clock = clock;
        this.logger = logger;
        this.windowMs = windowMs;

        this.peers = new Map();
        this.pausedUntil = 0;
        this.stopped = false;
    }

    // No await here, so two quick sends can't both open a burst.
    messageSent(peerPublicKeyHex) {

        if (this.stopped) {
            return;
        }

        const peer = peerPublicKeyHex.toLowerCase();
        const entry = this.peers.get(peer);

        if (entry) {
            entry.total++;
            entry.pending++;
            return;
        }

        const opened = { total: 1, pending: 1, cancelWindow: null };

        this.peers.set(peer, opened);
        this.startWindow(peer, opened, this.windowMs);

        if (!this.isPaused()) {
            this.pushPending(peer, opened);
        }
    }

    // Cancels the windows and flushes what they counted, without waiting for
    // the pushes. Not restartable; build a new one.
    stop() {

        this.stopped = true;

        for (const [peer, entry] of this.peers) {

            entry.cancelWindow();

            if (entry.pending > 0 && !this.isPaused()) {
                this.pushPending(peer, entry);
            }
        }

        this.peers.clear();
    }

    isPaused() {
        return this.clock.now() < this.pausedUntil;
    }

    startWindow(peer, entry, ms) {
        entry.cancelWindow = this.clock.timer(ms, () => this.endWindow(peer, entry));
    }

    endWindow(peer, entry) {

        if (entry.pending === 0) {
            this.peers.delete(peer);
            return;
        }

        if (this.isPaused()) {
            this.startWindow(peer, entry, this.pausedUntil - this.clock.now());
            return;
        }

        this.pushPending(peer, entry);
        this.startWindow(peer, entry, this.windowMs);
    }

    pushPending(peer, entry) {

        const count = entry.pending;

        entry.pending = 0;

        void this.push(peer, entry.total).then(throttled => {

            if (throttled) {
                entry.pending += count;
            }
        });
    }

    // Resolves to whether the server asked us to wait. Never rejects.
    async push(peer, total) {

        try {

            const own = this.identity.publicKeyHex ?? await this.identity.exportPublicHex();
            const topic = await notifyTopic(this.identity, own, peer);

            const response = await this.transporter.transport({
                url: `${this.ntfyUrl}/${topic}`,
                options: {
                    method: "POST",
                    headers: { ...NTFY_PUSH.headers },
                    body: total === 1 ? "New message" : `${total} new messages`,
                },
                timeout: NTFY_PUSH.timeout,
                maxBytes: NTFY_PUSH.maxBytes,
            });

            if (response.status === Status.TOO_MANY_REQUESTS) {
                const seconds = parseRetryAfter(response.headers?.[SmerpHeaders.retryAfter]);
                const waitMs = seconds === null ? NTFY_PUSH.defaultPauseMs : seconds * 1000;
                this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + waitMs);
                this.logger.warn("ntfy push rate limited", { waitMs });
                return true;
            }

            if (response.status !== 200) {
                this.logger.warn("ntfy push refused", { status: response.status });
            }
            else {
                this.logger.debug("ntfy push sent", { total });
            }
        }
        catch (error) {
            this.logger.warn("ntfy push failed", { reason: error.message });
        }

        return false;
    }
}
