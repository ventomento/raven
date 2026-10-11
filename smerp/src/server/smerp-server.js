// ============================================================
// MOCK SERVER FOR TESTING. DO NOT USE IN PRODUCTION.
// ============================================================

// src/server/smerp-server.js
import http from "node:http";
import { URL } from "node:url";
import { StorageServer } from "./storage-server.js";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { PrivateIdentity, readEnvelope } from "../../../smep/src/index.js";
import { RequestVerifier } from "../auth/request-signer.js";

export class SmerpServer {

  // The relay keypair is generated on construction unless privateKeyHex
  // is given. Clients learn its public key from the x-smerp-relay-pkh
  // header sent on every response, so nothing has to be configured.
  //
  // Every request must be signed. tokens: a Set of access tokens; when
  // given, every request must also carry one as a bearer token.
  constructor({
    storage = new StorageServer(),
    privateKeyHex = null,
    tokens = null,
  } = {}) {

    this.storage = storage;
    this.tokens = tokens;

    this.identityPromise = null;
    this.verifierPromise = null;

    this.#useIdentity(
      privateKeyHex === null
        ? PrivateIdentity.generate()
        : PrivateIdentity.fromPrivateKeyHex(privateKeyHex)
    );

    this.server = http.createServer(
      this.#handleRequest.bind(this)
    );

    Object.seal(this);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  listen(port, host = "0.0.0.0") {
    return new Promise((resolve) => {
      this.server.listen(
        port,
        host,
        resolve
      );
    });
  }

  // Current relay public key hex, as sent in x-smerp-relay-pkh.
  async relayPkh() {
    return (await this.identityPromise).publicKeyHex;
  }

  // Replace the relay keypair. Clients signing with the old key get a
  // 401 carrying the new one and retry.
  rotateKey() {
    this.#useIdentity(PrivateIdentity.generate());
    return this.relayPkh();
  }

  #useIdentity(identityPromise) {
    this.identityPromise = identityPromise;
    this.verifierPromise = identityPromise.then(
      identity => new RequestVerifier({ identity })
    );
  }

  close() {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
  
  // ============================================================
  // AUTHENTICATION
  // ============================================================

  // Verifies the request signature, then the access token if this relay
  // requires one. Returns { ok: true, pkh } or { ok: false, reason }.
  async #authenticate(req, body) {

    const verifier = await this.verifierPromise;

    const result = await verifier.verify({
      method: req.method,
      target: req.url,
      headers: req.headers,
      body,
    });

    if (!result.ok) {
      return result;
    }

    if (!this.#hasValidToken(req)) {
      return { ok: false, reason: "missing or invalid access token" };
    }

    return result;
  }

  #hasValidToken(req) {

    if (this.tokens === null) {
      return true;
    }

    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");

    return match !== null && this.tokens.has(match[1]);
  }

  #unauthorized(res, reason) {
    res.statusCode = 401;
    res.setHeader("x-smerp-unauthorized", reason);
    res.end();
  }

  // ============================================================
  // REQUEST ROUTER
  // ============================================================

  async #handleRequest(req, res) {

    try {
      // -------------------------------------------------
      // Allow CORS from everywhere
      // -------------------------------------------------

      res.setHeader("x-smerp-relay-pkh", await this.relayPkh());

      res.setHeader("Access-Control-Allow-Origin", "*");

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );

      res.setHeader("Access-Control-Allow-Headers", [
        "*",
        "content-type",
        "x-smerp-pkh",
        "x-smerp-timestamp",
        "x-smerp-signature",
        "authorization",
      ]);

      res.setHeader("Access-Control-Expose-Headers", [
        "x-smerp-cursor",
        "x-smerp-unauthorized",
        "x-smerp-relay-pkh",
      ]);

      const url =
        new URL(req.url, "http://localhost");

      // allow options for cors success.
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      // GET /
      if (req.method === "GET" && url.pathname === "/") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain");
          res.end("Hello from smerp server, I am running!");
          return;
      }

      // ========================================================
      // GET /dump
      // ========================================================

      if (
        req.method === "GET" &&
        url.pathname === "/dump"
      ) {

        res.statusCode = 200;

        res.setHeader(
          "Content-Type",
          "application/json"
        );

        res.end(
          JSON.stringify(
            this.storage.envelopesGet(),
            null,
            2
          )
        );

        return;
      }

      // ========================================================
      // POST /envelopes
      // ========================================================

      if (
        req.method === "POST" &&
        url.pathname === "/envelopes"
      ) {
        await this.#handleEnvelopesPost(
          req,
          res
        );
        return;
      }

      // ========================================================
      // GET /envelopes
      // ========================================================

      if (
        req.method === "GET" &&
        url.pathname === "/envelopes"
      ) {
        await this.#handleEnvelopesGet(
          req,
          res,
          url
        );
        return;
      }

      // ========================================================
      // NOT FOUND
      // ========================================================

      res.statusCode = 404;
      res.end();

    } catch (err) {

      console.error(err);

      res.statusCode = 500;
      res.end();
    }
  }

  // ============================================================
  // POST /envelopes
  // ============================================================

  async #handleEnvelopesPost(
    req,
    res
  ) {

    const contentType =
      req.headers["content-type"];

    if (
      contentType !==
      "application/octet-stream"
    ) {
      res.statusCode = 400;
      res.end();
      return;
    }

    const envelopeBuffer =
      await this.#readRequestBody(req);

    const auth =
      await this.#authenticate(req, envelopeBuffer);

    if (!auth.ok) {
      this.#unauthorized(res, auth.reason);
      return;
    }

    let unpacked;

    try {

      unpacked =
        readEnvelope(
          envelopeBuffer
        );

    } catch {

      res.statusCode = 400;
      res.end();
      return;
    }

    const uuid =
      bytesToHex(unpacked.uuid);

    const spkh =
      bytesToHex(
        unpacked.sender_public_key
      );

    const rpkh =
      bytesToHex(
        unpacked.recipient_public_key
      );

    // Mock policy: clients may upload envelopes they sent or received.
    // A relay that federates would also accept its known peers here.
    if (auth.pkh !== spkh && auth.pkh !== rpkh) {
      this.#unauthorized(res, "signer is neither sender nor recipient");
      return;
    }

    const size = envelopeBuffer.byteLength;

    try {

      this.storage.envelopesPost({
        uuid,
        spkh,
        rpkh,
        size,
        eb: envelopeBuffer,
      });

    } catch (err) {

      // duplicate UUID is considered success
      if (
        err.message ===
        "duplicate uuid"
      ) {
        res.statusCode = 200;
        res.end();
        return;
      }

      throw err;
    }

    res.statusCode = 200;
    res.end();
  }

  // ============================================================
  // GET /envelopes
  // ============================================================

  async #handleEnvelopesGet(
    req,
    res,
    url
  ) {

    const auth =
      await this.#authenticate(req);

    if (!auth.ok) {
      this.#unauthorized(res, auth.reason);
      return;
    }

    // The mailbox is the signer's.
    const pkh = auth.pkh;

    const idRaw =
      url.searchParams.get("cursor");

    const id =
      idRaw === null
        ? 0
        : Number(idRaw);

    if (
      !Number.isInteger(id)
    ) {
      res.statusCode = 400;
      res.end();
      return;
    }

    const records =
      this.storage.envelopesGet({
        pkh,
        id,
      });

    // return at most one envelope
    const record = records[0];

    if (!record) {
      res.statusCode = 204;
      res.end();
      return;
    }

    res.statusCode = 200;

    res.setHeader(
      "Content-Type",
      "application/octet-stream"
    );

    res.setHeader(
      "x-smerp-cursor", record.id
    );

    res.end(
      Buffer.from(record.eb)
    );
  }

  // ============================================================
  // READ REQUEST BODY
  // ============================================================

  #readRequestBody(req) {

    return new Promise(
      (resolve, reject) => {

        const chunks = [];

        req.on("data", (chunk) => {
          chunks.push(chunk);
        });

        req.on("end", () => {

          const buffer =
            Buffer.concat(chunks);

          const arrayBuffer =
            buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset +
              buffer.byteLength
            );

          resolve(arrayBuffer);
        });

        req.on("error", reject);
      }
    );
  }

}