import { MessageStore } from "../state/message-store.js";
import { RelayDirectory } from "../state/relay-directory.js";
import { EnvelopeOpener } from "../inbox/envelope-opener.js";
import { Ingestor } from "../inbox/ingestor.js";
import { RelaySession } from "../relay/relay-session.js";
import { RelayPool } from "../relay/relay-pool.js";
import { Sender } from "../outbox/sender.js";

/**
 * Builds the client's object graph for one start. rateLimits outlives it
 * (the client keeps it), so a restart cannot reset a relay's budget.
 */
export function composeClient({
    identity,
    publicKeyHex,
    transporter,
    storage,
    eventBus,
    logger,
    clock,
    rateLimits,
    slots,
}) {

    const messages = new MessageStore({ storage, eventBus, logger, clock });
    const directory = new RelayDirectory({ storage, eventBus });

    const ingestor = new Ingestor({
        opener: new EnvelopeOpener({ identity, publicKeyHex }),
        store: messages,
        eventBus,
        logger,
    });

    const pool = new RelayPool({
        createSession: (relay, onChange) => new RelaySession({
            relay,
            identity,
            transporter,
            logger,
            clock,
            bucket: rateLimits.for(relay.relayUrl),
            onChange,
        }),
        ingestor,
        directory,
        eventBus,
        logger,
        clock,
        slots,
    });

    const sender = new Sender({ identity, pool, logger });

    return { messages, directory, ingestor, pool, sender };
}
