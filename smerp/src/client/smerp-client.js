// src/client/smerp-client.js

/*
transport interface.
async function transport({
  url,
  options,
  timeout,
}) {

  return {
    status,
    headers,
    body,
  };
} 
*/

import {
  encrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../../smep/src/index.js";

import { StorageMemory } from "./storage/storage-memory.js";

export class SmerpClient {

  constructor({
    identity,
    transport,
    storage = new StorageMemory(),
    queueRelays = {},
    archiveRelays = {},
  }) {

    if (!(identity instanceof PrivateIdentity)) {
      throw new Error(
        "identity must be PrivateIdentity"
      );
    }

    if (typeof transport !== "function") {
      throw new Error(
        "transport must be function"
      );
    }

    this.identity = identity;

    this.transport = transport;

    this.queueRelays = queueRelays;
    this.archiveRelays = archiveRelays;

    this.seenUuids = {};
    this.conversations = {};
  }

  addQueueRelay(url) {

    this.queueRelays[url] = {
      enabled: true,
      lastSequenceId: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      failureCount: 0,
    };
  }

  addArchiveRelay(url) {

    this.archiveRelays[url] = {
      enabled: true,
      sid: null, //lastSequenceId
      lastSuccessAt: null,
      lastFailureAt: null,
      failureCount: 0,
    };
  }

  getConversation(publicKeyHex) {
    return this.conversations[publicKeyHex];
  }

  async sendData(
    recipientPublicKeyHex,
    data
  ) {

    const recipient =
      await PublicIdentity.fromPublicHex(
        recipientPublicKeyHex
      );

    const encrypted =
      await encrypt({
        sender: this.identity,
        recipient,
        plaintext: data,
      });

    const options = {
      method: "POST",

      headers: {
        "Content-Type":
          "application/octet-stream",
      },

      body: encrypted,
    };

    return await this.loopRelays(options);
  }


  async loopRelays(options) {
    return Promise.allSettled(
      [
        ...Object.entries(this.queueRelays),
        ...Object.entries(this.archiveRelays),
      ].map(([relayUrl, relay]) =>
        this.relayPost({ relayUrl, relay, options })
      )
    );
  }

  async relayPost({relayUrl, relay, options}) {
    if (!relay.enabled) {return;}

    try {

        const response =
          await this.transport({
            url: `${relayUrl}/envelopes` + (relay.sid ? `?sid=${relay.sid}` : ""),
            options,
            timeout: 10000
          });
        
        this.relaySuccess(relay);
        return response;

      } catch (error) {
        this.relayError(relay);
      } 

  }

  relaySuccess(relay) {
    relay.lastSuccessAt = Date.now();
    relay.failureCount = 0;
  }

  relayError(relay){
    relay.lastFailureAt = Date.now();
    relay.failureCount += 1;
  }
}