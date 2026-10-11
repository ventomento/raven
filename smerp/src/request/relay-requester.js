import { insist, PrivateIdentity } from "../../../smep/src/index.js";
import { TransportDefault } from "../transport/transport-default.js";
import { RequestSigner, normalizePkh } from "../auth/request-signer.js";
import { RealClock } from "../sync/rate-limiter.js";

export const RELAY_PKH_HEADER = "x-smerp-relay-pkh";

const UNAUTHORIZED = 401;

/**
 * Sends requests to relays. The only place relay requests are made.
 *
 * Each request is signed with the identity for relay.relayPkh and, if
 * relay.relayToken is set, carries it as a bearer token. Without a
 * known relayPkh the request goes out unsigned.
 *
 * relay.relayPkh is learned from the x-smerp-relay-pkh response header:
 * a new value is set on relay and reported to onRelayPkh(relayUrl, pkh).
 * A 401 carrying a pkh other than the one the request was signed with is
 * retried once, which covers first contact and key rotation.
 */
export class RelayRequester {

    constructor({
        identity,
        transporter = TransportDefault,
        logger,
        clock = RealClock,
        onRelayPkh = async () => {},
    }) {

        insist(identity, PrivateIdentity);
        insist(onRelayPkh, "function");

        this.identity = identity;
        this.transporter = transporter;
        this.logger = logger;
        this.clock = clock;
        this.onRelayPkh = onRelayPkh;
        this.signers = new Map(); // relayPkh -> RequestSigner
    }

    /**
     * request: { method, url, target, body?, headers? } (see RequestBuilder)
     * Returns the transport response { status, headers, body }.
     */
    async request(relay, request) {

        const signedWith = relay.relayPkh;

        let response = await this.#send(relay, request);

        const relayPkh = await this.#learnRelayPkh(relay, response);

        if (this.#shouldRetry(response, relayPkh, signedWith)) {
            response = await this.#send(relay, request);
            await this.#learnRelayPkh(relay, response);
        }

        return response;
    }

    async #send(relay, { method, url, target, body, headers = {} }) {

        return this.transporter.transport({
            url,
            options: {
                method,
                headers: {
                    ...headers,
                    ...(await this.#signatureHeaders(relay, { method, target, body })),
                    ...this.#tokenHeader(relay),
                },
                ...(body !== undefined && { body }),
            },
            logger: this.logger,
        });
    }

    async #signatureHeaders(relay, request) {

        if (!relay.relayPkh) {
            return {};
        }

        return this.#signerFor(relay.relayPkh).headers(request);
    }

    #tokenHeader(relay) {

        return relay.relayToken
            ? { authorization: `Bearer ${relay.relayToken}` }
            : {};
    }

    #signerFor(relayPkh) {

        let signer = this.signers.get(relayPkh);

        if (!signer) {
            signer = new RequestSigner({ identity: this.identity, relayPkh, clock: this.clock });
            this.signers.set(relayPkh, signer);
        }

        return signer;
    }

    // Returns the pkh the response announced, or null if it carried none
    // or a malformed one (e.g. a proxy's error page): the known pkh stays.
    async #learnRelayPkh(relay, response) {

        const value = response.headers?.[RELAY_PKH_HEADER];
        const relayPkh = normalizePkh(value);

        if (!relayPkh) {
            if (value !== undefined) {
                this.logger?.warn?.(`Invalid relay pkh received: ${value}`);
            }
            return null;
        }

        if (relayPkh !== relay.relayPkh) {
            relay.relayPkh = relayPkh;
            await this.onRelayPkh(relay.relayUrl, relayPkh);
        }

        return relayPkh;
    }

    #shouldRetry(response, relayPkh, signedWith) {

        return response.status === UNAUTHORIZED &&
            relayPkh !== null &&
            relayPkh !== signedWith;
    }
}
