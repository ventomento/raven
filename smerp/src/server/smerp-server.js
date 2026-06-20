// ============================================================
// MOCK SERVER FOR TESTING. DO NOT USE IN PRODUCTION.
// ============================================================

// src/server/smerp-server.js
import http from "node:http";
import { URL } from "node:url";
import { StorageServer } from "./storage-server.js";
import { Serializer } from "../../../smep/src/envelope/serializer.js";
import { bytesToHex } from "../../../smep/src/encoding/hex.js";
import { PrivateIdentity, PublicIdentity } from "../../../smep/src/index.js";
import { verify } from "../auth/protocol.js";

const AUTH_CONFIG = {
  publicKeyHex: "0xeb03b29ead5416dae89af429e77f649c3e9f8628cb032a12aa17a03e1d6bf249",
  privateKeyHex: "0xab534a94a7acad200f54653a81fc776980be44c91ea029f5b47eb16289d9da0f"
}

export class SmerpServer {

  constructor({
    storage = new StorageServer(),
  } = {}) {

    this.storage = storage;

    this.identityPromise =
    PrivateIdentity.fromPrivateKeyHex(
      AUTH_CONFIG.privateKeyHex
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
  
  async #authenticateGet(
  req,
  url
) {

  const pkh =
    url.searchParams.get("pkh");

  const timestamp =
    req.headers["x-smerp-timestamp"];

  const signature =
    req.headers["x-smerp-signature"];

  if (
    !pkh ||
    !timestamp ||
    !signature
  ) {
    return false;
  }

  const now =
    Math.floor(Date.now() / 1000);

  const ts =
    Number(timestamp);

  if (
    !Number.isInteger(ts) ||
    Math.abs(now - ts) > 300
  ) {
    return false;
  }

  const relayIdentity =
    await this.identityPromise;

  const clientIdentity =
    await PublicIdentity.fromPublicHex(
      pkh
    );

  const data =
    new TextEncoder().encode(
      timestamp
    );

  return verify({
    privateIdentity:
      relayIdentity,

    publicIdentity:
      clientIdentity,

    dataHex:
      bytesToHex(data),

    signatureHex:
      signature
  });
}

  // ============================================================
  // REQUEST ROUTER
  // ============================================================

  async #handleRequest(req, res) {

    try {
      // -------------------------------------------------
      // Allow CORS from everywhere
      // -------------------------------------------------

      res.setHeader("Access-Control-Allow-Origin", "*");

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );

      res.setHeader("Access-Control-Allow-Headers", [
        "*",
        "content-type",
        "x-smerp-timestamp",
        "x-smerp-signature",
      ]);

      res.setHeader("Access-Control-Expose-Headers", [
        "x-smerp-cursor",
        "x-smerp-unauthorized",
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

    let unpacked;

    try {

      unpacked =
        Serializer.unpack(
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

    const pkh =
      url.searchParams.get("pkh");

    if (
      !(await this.#authenticateGet(
        req,
        url
      ))
    ) {

      res.statusCode = 401;

      res.setHeader(
        "x-smerp-unauthorized",
        "invalid signature"
      );

      res.end();

      return;
    }

    const idRaw =
      url.searchParams.get("cursor");

    if (!pkh) {
      res.statusCode = 400;
      res.end();
      return;
    }

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