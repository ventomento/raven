import { deriveSharedSecret } from "../crypto/x25519.js";
import { sha256 } from "../crypto/hash.js";
import { encodeUtf8 } from "../encoding/utf8.js";
import { bytesToHex, hexToBytes } from "../encoding/hex.js";
import { PrivateIdentity, PublicIdentity } from "../identity/identity.js";
import { insist } from "../util/util.js";

const LABEL = encodeUtf8("smerp-ntfy-topic");

// The ntfy topic a sender pushes to when it sends to a recipient. Only the
// two parties can derive it (it hashes their X25519 shared secret), and it
// differs per direction (it hashes the recipient's key), so a phone listening
// to "peer -> me" doesn't buzz for our own sends. identity must be one of the
// two parties.
export async function notifyTopic(identity, senderPublicKeyHex, recipientPublicKeyHex) {

  insist(identity, PrivateIdentity);
  insist(senderPublicKeyHex, "string");
  insist(recipientPublicKeyHex, "string");

  const own = (identity.publicKeyHex ?? await identity.exportPublicHex()).toLowerCase();
  const sender = senderPublicKeyHex.toLowerCase();
  const recipient = recipientPublicKeyHex.toLowerCase();

  if (sender === recipient) {
    throw new Error("A note to self has no notify topic");
  }

  if (own !== sender && own !== recipient) {
    throw new Error("identity must be the sender or the recipient");
  }

  const peer = await PublicIdentity.fromPublicHex(own === sender ? recipient : sender);
  const shared = await deriveSharedSecret(identity.privateKey, peer.publicKey);
  const recipientBytes = hexToBytes(recipient);

  const input = new Uint8Array(LABEL.length + shared.length + recipientBytes.length);
  input.set(LABEL);
  input.set(shared, LABEL.length);
  input.set(recipientBytes, LABEL.length + shared.length);

  return "raven-" + bytesToHex(await sha256(input)).slice(0, 32);
}
