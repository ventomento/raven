// src/client/smerp-client.js

import {
  encrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../../smep/src/index.js";

import { insist } from "../../../smep/src/util/util.js";
import { StorageMemory } from "../storage/storage-memory.js";
import { RequestBuilder } from "../request/request-builder.js";
import { TransportDefault } from "../transport/transport-default.js";
import { SyncEngine } from "../sync/sync-engine.js";
import { LightLog } from "../log/light-log.js";
import { Ingestor } from "../ingest/ingestor.js";
import { EventBus, EventTypes } from "../event/event-bus.js";

export class SmerpClient {

  constructor({
    identity,
    transporter = TransportDefault,
    storage = new StorageMemory(),
    eventBus = new EventBus(),    
    debug = true,
    logger = new LightLog({debug})
  }) {

    insist(identity, PrivateIdentity);

    this.debug = debug;
    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.eventBus = eventBus;
    this.logger = logger;
    this.started = false;
    this.syncPromise = null;
    this.localPublicHex = null;
  }
  
  // =====================================================
  /* Public API */
  // =====================================================

  async sendData(
    publicKeyHex, 
    data
  ) {

    if (!this.started){
      throw new Error("smerp client not started! Send Aborted.");
    }

    const envelopeBytes = await this.encryptData(publicKeyHex, data);

    if ((await this.dispatch(envelopeBytes)).length > 0) {
      this.sync();
    } 
    else {
      throw new Error("Dispatch upload failed to all relays - Add working relays ! ")
    }
  }

  async conversationsGet(options) {
    return await this.storage.conversationsGet(options);
  }

  async envelopesGet(options){
    return await this.storage.envelopesGet(options)
  }

  async start() {
    if (this.started) {
      return;
    }
    
    this.started = true;

    await this.storage.init();

    try {
      // -------------------------------------------------
      // Bootstrap defaults
      // -------------------------------------------------
      if (this.debug) {
        await this.relaysPut({
          relayUrl: "http://localhost:8080",
          relayType: "archive"
        });
      }
      // -------------------------------------------------
      // Init async dependencies
      // -------------------------------------------------
      this.localPublicHex =
        await this.identity.exportPublicHex();

      this.ingestor =
        new Ingestor({
          storage: this.storage,
          identity: this.identity,
          localPublicHex: this.localPublicHex,
          eventBus: this.eventBus,
          logger: this.logger,
        });

      this.syncEngine =
        new SyncEngine({
          identity: this.identity,
          transporter: this.transporter,
          storage: this.storage,
          ingestor: this.ingestor,
          logger: this.logger,
          pkh: this.localPublicHex,
        });
      // -------------------------------------------------
      // Subscribe BEFORE sync
      // -------------------------------------------------
      this.subscribeEvents();
      // -------------------------------------------------
      // Initial sync
      // -------------------------------------------------
      void this.sync();
      // -------------------------------------------------
      // Periodic sync
      // -------------------------------------------------
      this.syncIntervalId = setInterval(
        () => void this.sync(),
        60 * 1000
      );
    }
    catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    await this.storage.close();

    // -------------------------------------------------
    // Stop periodic sync
    // -------------------------------------------------
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    this.unsubscribeEvents();
    
    // -------------------------------------------------
    // Reset runtime state
    // -------------------------------------------------
    this.syncPromise = null;
    this.ingestor = null;
    this.syncEngine = null;

  }

  onEnvelope = (event) => {
    // overwrite this for the UI to handle new envelope.
    this.logger.info("New envelope, but onNewEnvelope not overwritten by UI client.");
  }
  
  onConversation = (event) => {
    // overwrite this in the UI client to handle new conversation.
    this.logger.info("New conversation, but onNewConversation not overwritten by UI client.");
  }

  onDispatch = (event) => {
    //overwrite this for UI handling
    this.logger.info("Dispatch Results, but onDispatch not overwritten by UI client.");
  }

  async relaysPut({relayUrl, relayType}){
    insist(relayUrl, "string");
    insist(relayType, "string");

    return await this.storage.relaysPut({relayUrl, relayType});
  }

  async relaysGet(options={}){
    return await this.storage.relaysGet(options);
  }

  async relaysDelete(relayUrl){
    // todo: implement;
    this.logger.info("relaysDelete: Not implemented!");
  }

  // public api stops. =====================================================
  // henceforth only internal functions.

  subscribeEvents(){
    this.unsubscribeConversation =
      this.eventBus.subscribe(
        EventTypes.NEW_CONVERSATION,
        (event) => this.onConversation(event)
      );

    this.unsubscribeEnvelope =
      this.eventBus.subscribe(
        EventTypes.NEW_ENVELOPE,
        (event) => this.onEnvelope(event)
      );

    this.unsubscribeDispatch =
      this.eventBus.subscribe(
        EventTypes.RESULTS_DISPATCH,
        (event) => this.onDispatch(event)
      );
  }

  unsubscribeEvents(){
    this.unsubscribeConversation?.();
    this.unsubscribeEnvelope?.();
    this.unsubscribeDispatch?.();
  }

  sync() {

    if (!this.started || this.syncPromise) {
      return;
    }

    this.syncPromise = 
      this.performSync()
      .catch((error) => {
        this.logger.error("Sync failed", error);
      })
      .finally(() => {
        this.syncPromise = null;
      });
  }

  async performSync() {
    const relays = await this.storage.relaysGet();
    await this.syncEngine.syncRelays(relays);
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
      return this.dispatchToRelay(relay, envelopeBytes, this.transporter);
    })

    const results = await Promise.allSettled(promises);

    const successful = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    const failed = results
      .filter(r => r.status === "rejected")
      .map(r => r.reason);

    this.logger.info("Dispatch: Uploaded to relays: ", {successful});
    this.logger.info("Dispatch: Failed upload to relays: ", {failed});

    this.eventBus.publish({
      type: EventTypes.RESULTS_DISPATCH,
      relayUrls: successful
    });

    return successful;
  }

  async dispatchToRelay(relay, envelopeBytes, transporter) {

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
  
}
