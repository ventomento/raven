import { SmerpClient } from "../smerp-client";
import { insist } from "../../../smep/src/util/util";
import { RequestBuilder } from "../request/request-builder";

export class SyncEngine {

    constructor({
        smerpClient
    }) {
        insist(smerpClient, SmerpClient);

        this.smerpClient = smerpClient;
        this.transporter = this.smerpClient.transporter;
        this.identity = this.smerpClient.identity;
    }

    async syncRelays(relays) {

        relays.forEach( (relay) =>
            this.syncRelay(relay)
        );

    }

    async syncRelay(relay) {
        if (relay.disabled){
            return;
        }

        const pkh = await this.identity.exportPublicHex();

        for(let i=0; i<10; i++) { //prevent infinite loop with while(1)

            const {status, headers, body} = await this.transporter.transport({
                url: RequestBuilder.urlEnvelopesGet(relay, pkh),
            });

            if (status === 204){
                return;
            }

            if (! (status === 200)){
                // TODO: set possible relay errors
                return;
            }      
            
            const nextCursor = this._nextCursor(headers);

            if (!nextCursor){
                await this.smerpClient.relaysPut({...relay, disabled: true});
                return;
            }
            
            const ingested = await this.smerpClient.ingest(body);

            if (ingested){
                await this.smerpClient.relaysPut({...relay, cursor: nextCursor});
            }

        }

    }

    _nextCursor(headers) {
        try{
            return JSON.parse(headers.get("x-smerp-meta")).id;
        } catch (e) {
            return false;
        }
    }
    
}