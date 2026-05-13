// tests/protocol.roundtrip.test.js

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  encrypt,
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../src/protocol/protocol.js";

describe("protocol encrypt/decrypt roundtrip from A perspective", () => {

  test("A -> B encrypt, A decrypt own outgoing message", async () => {

    const A = await PrivateIdentity.generate();
    const B = await PrivateIdentity.generate();

    const BPublic =
      new PublicIdentity(B.publicKey);

    const cleartext =
      "hello from A to B";

    const envelopeBytes =
      await encrypt({
        sender: A,
        recipient: BPublic,
        plaintext: cleartext,
      });

    // decrypt as A (sender perspective)
    const decrypted =
      await decrypt({
        identity: A,
        envelopeBytes,
      });

    assert.equal(
      decrypted.plaintext,
      cleartext
    );
  });

  test("A -> A roundtrip", async () => {

    const A = await PrivateIdentity.generate();

    const APublic =
      new PublicIdentity(A.publicKey);

    const cleartext =
      "hello from A to A";

    const envelopeBytes =
      await encrypt({
        sender: A,
        recipient: APublic,
        plaintext: cleartext,
      });

    const decrypted =
      await decrypt({
        identity: A,
        envelopeBytes,
      });

    assert.equal(
      decrypted.plaintext,
      cleartext
    );
  });

  test("B -> A decrypt as A", async () => {

    const A = await PrivateIdentity.generate();
    const B = await PrivateIdentity.generate();

    const APublic =
      new PublicIdentity(A.publicKey);

    const cleartext =
      "hello from B to A";

    const envelopeBytes =
      await encrypt({
        sender: B,
        recipient: APublic,
        plaintext: cleartext,
      });

    // decrypt as A (recipient perspective)
    const decrypted =
      await decrypt({
        identity: A,
        envelopeBytes,
      });

    assert.equal(
      decrypted.plaintext,
      cleartext
    );
  });

});