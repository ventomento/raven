// src/smerp-client.js

import {
  encrypt,
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../smep/src/index.js";

import { insist } from "../../smep/src/util/util.js";
import { StorageMemory } from "./storage/storage-memory.js";
import { RequestBuilder } from "./request/request-builder.js";
import { TransportDefault } from "./transport/transport-default.js";
import { SyncEngine } from "./sync/sync-engine.js";
import { LoggerDefault} from "./log/logger-default.js";

const defaultConfig = {relaySeedList: [{relayUrl: "http://localhost:8080", type: "archive"}]}

export class SmerpClient {

  constructor({
    identity,
    transporter = new TransportDefault(),
    storage = new StorageMemory(),
    debug = true,
    config = defaultConfig,
    logger = LoggerDefault
  }) {

    insist(identity, PrivateIdentity);

    this.debug = debug;
    this.config = config;
    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.logger = logger;
    this.ingestor = new Ingestor({
        storage: this.storage,
        identity: this.identity,
        emit: this.emit?.bind(this),
      });

    if (this.debug){
      console.log("Remember to start().");
    }
  }

  async start(){
    await this.seedRelays();

    this.syncEngine = new SyncEngine({
      smerpClient: this,
      pkh: await this.identity.exportPublicHex()
    });

    const streamResults = await this.syncEngine.syncRelays(await this.relaysGet());

    this.logger.info(
        "sync complete. status:",
        {
          streams: streamResults,
        }
    );
  }

  async seedRelays(){
    if ( (await this.relaysGet()).length === 0) {

      for (const relay of this.config.relaySeedList) {
        await this.storage.relaysPut(relay);
      }

    }
  }

  /* return: encrypted envelope bytes */
  async encryptData(
    publicKeyHex,
    data
  ) {

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

  async ingest(envelopeBytes){
    await this.ingestor.ingest(envelopeBytes);
  }

  async dispatch(envelopeBytes){
    const relays = await this.storage.relaysGet();

    const promises = relays.map( (relay) => {

      return this.transporter.transport({
        url: RequestBuilder.urlEnvelopesPost(relay),
        options: RequestBuilder.optionsEnvelopesPost(envelopeBytes),
      })

    })

    return await Promise.allSettled(promises);
  }

// =====================================================
  /* Public API */
// =====================================================

  async sendData(
    publicKeyHex, 
    data
  ) {

    const envelopeBytes = await this.encryptData(publicKeyHex, data);

    return await this.dispatch(envelopeBytes);
  }

  async conversationsGet(){
    return await this.storage.conversationsGet();
  }

  async envelopesGet(publicKeyHex){
    return await this.storage.envelopesGet(publicKeyHex);
  } 

  async relaysGet(){
    return await this.storage.relaysGet();
  }

  async relaysPut(relay){
    return await this.storage.relaysPut(relay);
  }
  
}

// =====================================================
// Ingestor
// =====================================================

class Ingestor {

  constructor({
    storage,
    identity,
    emit = null,
  }) {

    this.storage = storage;
    this.identity = identity;
    this.emit = emit;
  }

  async getLocalPublicHex(){

    if ( this.localPublicHex === undefined ){
      this.localPublicHex = await this.identity.exportPublicHex();
    }
    
    return this.localPublicHex;
  }

  async isIdentity(publicHex){
    
    return (await this.getLocalPublicHex()) === publicHex;
  }

  // =====================================================
  // PUBLIC ENTRY
  // =====================================================

  async ingest(
    envelopeBytes
  ){

    insist(envelopeBytes, ArrayBuffer);

    const receivedAt = Date.now();

    const envelope = await decrypt({
      identity: this.identity,
      envelopeBytes
    });

    if ( await this.checkDuplicate(envelope.uuid) ) {
      return false;
    }

    const enriched = await this.buildEnrichedEnvelope({
        envelope,
        receivedAt,
        });

    await this.storagePut(enriched);
    return true;
  }

  async storagePut(envelope){
    await this.storage.envelopesPut(envelope);
    await this.upsertConversation(envelope);
  }

  // =====================================================
  // DEDUP
  // =====================================================

  async checkDuplicate(uuid) {

    const existing =
      await this.storage.envelopesGet({
        uuid,
        limit: 1,
      });

    return existing.length > 0;
  }

  // =====================================================
  // ENRICHMENT
  // =====================================================

  async buildEnrichedEnvelope({
    envelope,
    receivedAt,
  }) {

    const outbound = await this.isIdentity( envelope.senderPublicKeyHex );

    const publicKeyHex =
      outbound
        ? envelope.recipientPublicKeyHex
        : envelope.senderPublicKeyHex;

    return {
      ...envelope,
      publicKeyHex,
      direction: outbound
        ? "outbound"
        : "inbound",
      receivedAt,
      read: outbound,
    };
  }

 // =====================================================
// CONVERSATION LOGIC
// =====================================================

  async upsertConversation(envelope) {

    const publicKeyHex = envelope.publicKeyHex;

    const [existingConversation] =
      await this.storage.conversationsGet({
        publicKeyHex,
        limit: 1,
      });

    const conversation = {
      ...(existingConversation ?? {}),

      publicKeyHex,

      unreadCount:
        (existingConversation?.unreadCount ?? 0) +
        (envelope.direction === "outbound" ? 0 : 1),

      lastMessageAt:
        existingConversation &&
        existingConversation.lastMessageAt > envelope.timestamp
          ? existingConversation.lastMessageAt
          : envelope.timestamp,
    };

    await this.storage.conversationsPut(conversation);

    return conversation;
  } 

}


/* Record Models in storage 

# relay record:
relayUrl
disabled;
sid
lastSuccessAt
lastFailureAt
failureCount

# envelope record:
senderPublicKeyHex
recipientPublicKeyHex
contentType
plaintext
timestamp
uuid
relayUrl,
receivedAt,

#conversation record:
publicKeyHex
unreadCount
lastMessageAt

*/