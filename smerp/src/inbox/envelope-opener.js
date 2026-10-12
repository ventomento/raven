import { decryptEnvelope, PrivateIdentity, readEnvelope, bytesToHex } from "../../../smep/src/index.js";
import { insist } from "../../../smep/src/util/util.js";

/**
 * Turns envelope bytes into a record ready to store. No storage.
 *
 * Opening is split in two so a duplicate can be dropped by uuid before
 * paying for decryption:
 *
 *   read(bytes)      parse, size check  → { uuid, envelope }
 *   open(envelope)   decrypt, map       → record (without receivedAt)
 *
 * Both throw when the envelope itself is bad; retrying gives the same
 * result.
 */
export class EnvelopeOpener {

    // publicKeyHex: the identity's, which a PrivateIdentity may not carry.
    constructor({ identity, publicKeyHex }) {

        insist(identity, PrivateIdentity);
        insist(publicKeyHex, "string");

        this.identity = identity;
        this.publicKeyHex = publicKeyHex;
    }

    read(bytes) {

        const envelope = readEnvelope(bytes);

        return { uuid: bytesToHex(envelope.uuid), envelope };
    }

    // The wire timestamp (smep, seconds) becomes sentAt in milliseconds.
    async open(envelope) {

        const { timestamp, ...rest } = await decryptEnvelope({
            identity: this.identity,
            envelope,
        });

        const outbound = rest.senderPublicKeyHex === this.publicKeyHex;

        return {
            ...rest,
            sentAt: timestamp * 1000,
            publicKeyHex: outbound
                ? rest.recipientPublicKeyHex
                : rest.senderPublicKeyHex,
            direction: outbound ? "outbound" : "inbound",
            read: outbound,
        };
    }
}
