export class StorageInterface {
  async init() {
    throw new Error(
      "init() not implemented"
    );
  }

  async close() {
    throw new Error(
      "close() not implemented"
    );
  }

  async envelopesGet(options = {}) {
    throw new Error(
      "envelopesGet() not implemented"
    );
  }

  async envelopesPut(record) {
    throw new Error(
      "envelopesPut() not implemented"
    );
  }

  async conversationsGet(options = {}) {
    throw new Error(
      "conversationsGet() not implemented"
    );
  }

  async conversationsPut(record) {
    throw new Error(
      "conversationsPut() not implemented"
    );
  }

  async relaysGet(options = {}) {
    throw new Error(
      "relaysGet() not implemented"
    );
  }

  async relaysPut(record) {
    throw new Error(
      "relaysPut() not implemented"
    );
  }

  async relaysDelete(options) {
    throw new Error(
      "relaysDelete() not implemented"
    );
  }

}

export function newestFirst(a, b) {
  return (b.sentAt - a.sentAt) || (b.receivedAt - a.receivedAt);
}

export function isBefore(envelope, { beforeSentAt, beforeReceivedAt }) {

  if (envelope.sentAt !== beforeSentAt || beforeReceivedAt === undefined) {
    return envelope.sentAt < beforeSentAt;
  }

  return envelope.receivedAt < beforeReceivedAt;
}
