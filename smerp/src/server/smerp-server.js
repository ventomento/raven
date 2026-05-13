// src/server/smerp-server.js

import http from "node:http";
import { URL } from "node:url";

import { StorageServer } from "./storage-server.js";

import { Serializer } from "../../../smep/src/envelope/serializer.js";

import { bytesToHex } from "../../../smep/src/encoding/hex.js";

export class HttpServer {

  constructor({
    storage = new StorageServer(),
  } = {}) {

    this.storage = storage;

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

  // ============================================================
  // REQUEST ROUTER
  // ============================================================

  async #handleRequest(req, res) {

    try {

      const url =
        new URL(req.url, "http://localhost");

        // GET /
        if (req.method === "GET" && url.pathname === "/") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain");
            res.end("Hello from smerp server, I am running!");
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

    try {

      this.storage.envelopesPost({
        uuid,
        spkh,
        rpkh,
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

    const idRaw =
      url.searchParams.get("id");

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
      "x-metadata",
      JSON.stringify({
        id: record.id,
      })
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