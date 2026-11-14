/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { insist, PrivateIdentity, PublicIdentity } from "../../../smep/src/internal.js";
import { RealClock } from "../lib/clock.js";
import { hmacKeyFor, signTarget } from "../auth/request-signer.js";

export class RequestBuilder {

    static DEFAULTS = Object.freeze({
        timeoutMs: 30 * 1000,
    });

    constructor({
        relayUrl,
        identity,
        clock = RealClock,
    }) {

        insist(relayUrl, "string");
        insist(identity, PrivateIdentity);

        this.relayUrl = relayUrl;
        this.identity = identity;
        this.clock = clock;

        this.cachedKey = null;
    }

    buildGet(cursor, relayPkh) {

        return this.build({
            method: "GET",
            target: `/envelopes?cursor=${cursor}`,
        }, relayPkh);
    }

    buildPost(envelopeBytes, relayPkh) {

        return this.build({
            method: "POST",
            target: "/envelopes",
            body: envelopeBytes,
        }, relayPkh);
    }

    // No request headers and no Content-Type: a browser sends this without a
    // preflight (smerp_rfc section 1). no-store keeps batches off its disk.
    async build({ method, target, body }, relayPkh) {

        const finalTarget = relayPkh
            ? await this.sign({ method, target, body }, relayPkh)
            : target;

        return {
            url: `${this.relayUrl}${finalTarget}`,
            options: {
                method,
                cache: "no-store",
                ...(body !== undefined && { body }),
            },
            timeout: RequestBuilder.DEFAULTS.timeoutMs,
        };
    }

    async sign({ method, target, body }, relayPkh) {

        return signTarget({
            method,
            target,
            body,
            pkh: this.identity.publicKeyHex ?? await this.identity.exportPublicHex(),
            timestamp: Math.floor(this.clock.now() / 1000).toString(),
            hmacKey: await this.hmacKey(relayPkh),
        });
    }

    hmacKey(relayPkh) {

        if (this.cachedKey?.relayPkh !== relayPkh) {
            this.cachedKey = {
                relayPkh,
                keyPromise: PublicIdentity.fromPublicHex(relayPkh)
                    .then(relay => hmacKeyFor(this.identity, relay)),
            };
        }

        return this.cachedKey.keyPromise;
    }
}
