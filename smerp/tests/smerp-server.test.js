// tests/http-server.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { HttpServer } from "../../smerp/src/server/smerp-server.js";

import {
  encrypt,
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../smep/src/protocol/protocol.js";

const HOST = "127.0.0.1";
const PORT = 8081;

test("POST /envelopes stores envelope", async () => {

  const server =
    new HttpServer();

  await server.listen(PORT, HOST);

  try {

    // --------------------------------------------------------
    // identities
    // --------------------------------------------------------

    const A =
      await PrivateIdentity.generate();

    const B =
      await PrivateIdentity.generate();

    const BPublic =
      new PublicIdentity(
        B.publicKey
      );

    // --------------------------------------------------------
    // create envelope
    // --------------------------------------------------------

    const cleartext =
      "hello world";

    const envelopeBytes =
      await encrypt({
        sender: A,
        recipient: BPublic,
        plaintext: cleartext,
      });

    // --------------------------------------------------------
    // POST
    // --------------------------------------------------------

    const response =
      await fetch(
        `http://${HOST}:${PORT}/envelopes`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/octet-stream",
          },

          body: envelopeBytes,
        }
      );

    assert.equal(
      response.status,
      200
    );

    // --------------------------------------------------------
    // verify storage
    // --------------------------------------------------------

    assert.equal(
      server.storage.records.length,
      1
    );

  } finally {

    await server.close();
  }
});

test("GET /envelopes returns stored envelope", async () => {

  const server =
    new HttpServer();

  await server.listen(PORT, HOST);

  try {

    // --------------------------------------------------------
    // identities
    // --------------------------------------------------------

    const A =
      await PrivateIdentity.generate();

    const B =
      await PrivateIdentity.generate();

    const BPublic =
      new PublicIdentity(
        B.publicKey
      );

    // --------------------------------------------------------
    // create envelope
    // --------------------------------------------------------

    const cleartext =
      "hello from A to B";

    const envelopeBytes =
      await encrypt({
        sender: A,
        recipient: BPublic,
        plaintext: cleartext,
      });

    // --------------------------------------------------------
    // POST envelope
    // --------------------------------------------------------

    const postResponse =
      await fetch(
        `http://${HOST}:${PORT}/envelopes`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/octet-stream",
          },

          body: envelopeBytes,
        }
      );

    assert.equal(
      postResponse.status,
      200
    );

    // --------------------------------------------------------
    // GET envelope
    // --------------------------------------------------------

    const BPublicHex =
      await B.exportPublicHex();

    const getResponse =
      await fetch(
        `http://${HOST}:${PORT}/envelopes?pkh=${BPublicHex}&id=0`
      );

    assert.equal(
      getResponse.status,
      200
    );

    assert.equal(
      getResponse.headers.get(
        "content-type"
      ),
      "application/octet-stream"
    );

    // --------------------------------------------------------
    // metadata header
    // --------------------------------------------------------

    const metadata =
      JSON.parse(
        getResponse.headers.get(
          "x-metadata"
        )
      );

    assert.equal(
      metadata.id,
      1
    );

    // --------------------------------------------------------
    // binary body
    // --------------------------------------------------------

    const returnedEnvelopeBytes =
      await getResponse.arrayBuffer();

    // --------------------------------------------------------
    // decrypt returned envelope
    // --------------------------------------------------------

    const decrypted =
      await decrypt({
        identity: B,
        envelopeBytes:
          returnedEnvelopeBytes,
      });

    assert.equal(
      decrypted.plaintext,
      cleartext
    );

  } finally {

    await server.close();
  }
});

test("GET /envelopes returns 204 when no envelope exists", async () => {

  const server =
    new HttpServer();

  await server.listen(PORT, HOST);

  try {

    const A =
      await PrivateIdentity.generate();

    const APublicHex =
      await A.exportPublicHex();

    const response =
      await fetch(
        `http://${HOST}:${PORT}/envelopes?pkh=${APublicHex}&id=0`
      );

    assert.equal(
      response.status,
      204
    );

  } finally {

    await server.close();
  }
});