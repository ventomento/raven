// src/smerp-client.js

import {
  encrypt,
  decrypt,
  PrivateIdentity,
  PublicIdentity,
} from "../../smep/src/index.js";

import { require } from "../../smep/src/util/util.js";
import { StorageMemory } from "./storage/storage-memory.js";
import { measureLag } from "./atx/lag-monitor.js";
import { TransportDefault } from "./transport/transport-default.js";

export class SmerpClient {

  constructor({
    identity,
    transporter = new TransportDefault(),
    storage = new StorageMemory(),
    debug = true
  }) {

    require(identity, PrivateIdentity);

    this.debug = debug;
    this.identity = identity;
    this.transporter = transporter;
    this.storage = storage;
    this.ingestor = new Ingestor({
        storage: this.storage,
        identity: this.identity,
        emit: this.emit?.bind(this),
      });

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

    /*await measureLag(
      async () => {
        await this.ingestor.ingest(envelopeBytes) 
      },
      {
        name : "smerp-client ingest",
        debug: this.debug
      }
    );*/
    await this.ingestor.ingest(envelopeBytes) 
  }

  async dispatch(envelopeBytes){

    const options = {...requestPostOptions, body: envelopeBytes};
    const relays = await this.storage.relaysGet();

    const promises = relays.map( (relay) => {

      const url = `${relay.relayUrl}/envelopes` + (relay.sid ? `?sid=${relay.sid}` : "");

      return this.transporter.transport({
        url,
        options,
        timeout:10000
      })

    })

    return await Promise.allSettled(promises);
  }

  /* Public API */

  async sendData(
    publicKeyHex, //Destination hex (may not send to this.identity)
    data
  ) {

    const envelopeBytes = await measureLag(
      async () => {
        return await this.encryptData(publicKeyHex, data);
      },
      {
        name : "smerp-client encrypt",
        debug: this.debug
      }
    );

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
  
}

// module const

const requestPostOptions = {
      method: "POST",
      headers: {
        "Content-Type":
          "application/octet-stream",
      },
    }; 

// =====================================================
// Ingestor
// =====================================================

export class Ingestor {

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

    require(envelopeBytes, ArrayBuffer);

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

    const publicKeyHex =
      envelope.publicKeyHex;

    const conversations =
      await this.storage.conversationsGet({
        publicKeyHex,
        limit: 1,
      });

    let conversation =
      conversations[0];

    if (!conversation) {
      conversation = this.createConversation(envelope);
    } else {
      conversation = this.updateConversation(
        conversation,
        envelope
      );
    }

    await this.storage.conversationsPut(
      conversation
    );

    return conversation;
  }

  createConversation(envelope) {

    return {
      publicKeyHex: envelope.publicKeyHex,
      unreadCount: envelope.direction === "inbound" ? 1 : 0,
      lastMessageAt: envelope.timestamp,
    };
  }

  updateConversation(conversation, envelope) {

    const isOutbound =
      envelope.direction === "outbound";

    return {
      ...conversation,

      unreadCount:
        isOutbound
          ? conversation.unreadCount
          : conversation.unreadCount + 1,

      lastMessageAt: 
        conversation.lastMessageAt > envelope.timestamp ? conversation.lastMessageAt : envelope.timestamp,
    };
  }

}


/* Record Models in storage 

# relay record:
relayUrl
enabled
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