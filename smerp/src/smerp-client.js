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
} from "../../smep/src/index.js";

import { StorageMemory } from "./storage/storage-memory.js";
import { Ingestor } from "./ingest/ingestor.js";
import { measureLag } from "./atx/lag-monitor.js";

export class SmerpClient {

  constructor({
    identity,
    transport,
    storage = new StorageMemory(),
    debug = true
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
    this.ingestor =
      new Ingestor({
        storage,
        identity: this.identity,
        emit: this.emit?.bind(this),
      });

  }

  async encryptData(
    recipientPublicKeyHex,
    data
  ) {
    
    const recipient =
      await PublicIdentity.fromPublicHex(
        recipientPublicKeyHex
      );

    return await encrypt({
        sender: this.identity,
        recipient,
        plaintext: data,
      });

  }

  async sendData(
    data
  ) {

    const options = {
      method: "POST",

      headers: {
        "Content-Type":
          "application/octet-stream",
      },

      body: data,
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
        
        return response;

      } catch (error) {
        throw(error);
      } 

  }

  ingest(envelope){

    measureLag(
      () => { this.ingestor.ingest(envelope) },
      this.debug
    );
    
  }

  //views 

  async conversationsGet(){
    return await this.storage.conversationsGet();
  }

  async envelopesGet(publicKeyHex){
    return await this.storage.envelopesGet(publicKeyHex);
  } 

  async relaysGet(){
    return await this.storage.relaysGet();
  }
  
}

