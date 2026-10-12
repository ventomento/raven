import {
    encrypt,
    PrivateIdentity,
    PublicIdentity,
    readEnvelope,
    bytesToHex,
} from "../../../smep/src/index.js";

import { insist } from "../../../smep/src/util/util.js";
import { ContentTypes } from "../../../smep/src/envelope/content-types.js";
import { RelayPool } from "../relay/relay-pool.js";
import { DispatchError } from "../client/errors.js";

/**
 * Encrypts a message and uploads it to every enabled relay.
 *
 * Nothing is stored here. Like every envelope, it is stored when a sync
 * fetches it back from a relay; send() wakes the pool for that.
 */
export class Sender {

    constructor({ identity, pool, logger }) {

        insist(identity, PrivateIdentity);
        insist(pool, RelayPool);
        insist(logger);

        this.identity = identity;
        this.pool = pool;
        this.logger = logger;
    }

    /**
     * plaintext: string | Uint8Array. contentType defaults to TEXT_UTF8
     * for strings, UNKNOWN for bytes. The envelope may be at most 4 MiB.
     *
     * Resolves with { uuid, delivered, failed } once at least one relay
     * accepted it. Throws DispatchError if none did.
     */
    async send(
        recipientPublicKeyHex,
        plaintext,
        {
            contentType = defaultContentType(plaintext),
        } = {}
    ) {

        insist(recipientPublicKeyHex, "string");

        if (!(
            typeof plaintext === "string" ||
            plaintext instanceof Uint8Array
        )) {
            throw new TypeError(
                "plaintext must be string or Uint8Array"
            );
        }

        const recipient = await PublicIdentity.fromPublicHex(recipientPublicKeyHex);

        const envelopeBytes = await encrypt({
            sender: this.identity,
            recipient,
            plaintext,
            contentType,
        });

        const { delivered, failed } = await this.#dispatch(envelopeBytes);

        if (delivered.length === 0) {
            throw new DispatchError(failed);
        }

        void this.pool.wakeIdle();

        const uuid = bytesToHex(readEnvelope(envelopeBytes).uuid);

        return { uuid, delivered, failed };
    }

    async #dispatch(envelopeBytes) {

        const relayUrls = this.pool.relayUrls();

        const results = await Promise.allSettled(
            relayUrls.map(
                relayUrl => this.pool.runNow(
                    relayUrl,
                    session => session.post(envelopeBytes)
                )
            )
        );

        const delivered = [];
        const failed = [];

        results.forEach((result, i) => {

            const relayUrl = relayUrls[i];

            if (result.status === "fulfilled") {
                delivered.push(relayUrl);
            }
            else {
                failed.push({ relayUrl, error: result.reason });
            }
        });

        this.logger.info("Dispatch:", { delivered, failed });

        return { delivered, failed };
    }
}

function defaultContentType(plaintext) {
    return typeof plaintext === "string"
        ? ContentTypes.TEXT_UTF8
        : ContentTypes.UNKNOWN;
}
