// src/smerp-client.js

import {
  encrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../smep/src/index.js";

import { insist } from "../../smep/src/util/util.js";
import { StorageMemory } from "./storage/storage-memory.js";
import { RequestBuilder } from "./request/request-builder.js";
import { TransportDefault } from "./transport/transport-default.js";
import { SyncEngine } from "./sync/sync-engine.js";
import { LightLog } from "./log/light-log.js";
import { Ingestor } from "./ingest/ingestor.js";


export class SmerpClient {

  constructor({
    identity,
    transporter = TransportDefault,
    storage = new StorageMemory(),
    debug = true,
    logger = new LightLog({debug}),
  }) {

    insist(identity, PrivateIdentity);

    this.debug = debug;
    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.logger = logger;
  }
  
  // =====================================================
  /* Public API */
  // =====================================================

  async sendData(
    publicKeyHex, 
    data
  ) {
    const envelopeBytes = await this.encryptData(publicKeyHex, data);

    if (await this.dispatch(envelopeBytes)) {
      this.sync();
    }
  }

  async start(){

    await this.seedRelays();

    this.ingestor = new Ingestor({
        storage: this.storage,
        identity: this.identity,
        localPublicHex: await this.identity.exportPublicHex(),
        logger: this.logger,
        emit: this.emit?.bind(this),
      });
    
    this.syncEngine = new SyncEngine({
      smerpClient: this,
      pkh: await this.identity.exportPublicHex()
    });

    this.sync();
    this.syncIntervalId = setInterval(
      () => this.sync(), // make closure on this
      60 * 1000   // every 1 minute
    );
  }

  stop(){
    if (typeof this.syncIntervalId !== "undefined"){
      clearInterval(this.syncIntervalId);
      this.intervalId = null;
    }
  }
  
  // =====================================================

  async sync(){

    const relays = await this.storage.relaysGet();
    const promises = await this.syncEngine.syncRelays(relays);

    return promises;
  }


  /* return: encrypted envelope bytes */
  async encryptData(publicKeyHex, data) {

    const recipient =
      await PublicIdentity.fromPublicHex(
        publicKeyHex
      );

    return await encrypt({
        sender: this.identity,
        recipient,
        plaintext: data,
      });

  }

  async dispatch(envelopeBytes){

    const relays = await this.storage.relaysGet();

    const promises = relays.map( (relay) => {
      return this.dispatchMiddleware(relay, envelopeBytes, this.transporter);
    })
    
    const successfulRelayUrls = 
    (await Promise.allSettled(promises))
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);

    this.logger.info("Dispatch Successfully uploaded to relays:", {successfulRelayUrls});
    return successfulRelayUrls;
  }

  async dispatchMiddleware(relay, envelopeBytes, transporter) {

    const response = 
    await transporter.transport({
      url: RequestBuilder.urlEnvelopesPost(relay),
      options: RequestBuilder.optionsEnvelopesPost(envelopeBytes),
      logger: this.logger
    })

    if (response.status !== 200) {
      throw new Error(`Relay dispatch failed: ${response.status}`);
    }

    return relay.relayUrl;
  }
  
  async seedRelays(){
    this.logger.info("Seeding relays");

    // Todo: seed from config.  

    if(this.debug){
      await this.seedRelaysDebug();
    }
  }

  async seedRelaysDebug() {
    const relaySeedList = [{relayUrl: "http://localhost:8080", type: "archive"}];

    this.logger.info("Seeding debug relays (localhost)", {seedList: relaySeedList});

    for (const relay of relaySeedList) {
      await this.storage.relaysPut({...relay});
    }

  }

}
