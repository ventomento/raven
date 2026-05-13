
export class RequestBuilder {

    static urlEnvelopesGet(relay, pkh){
      return `${relay.relayUrl}/envelopes?pkh=${pkh}` + (relay.cursor ? `&id=${relay.cursor}` : "");
    }

    static urlEnvelopesPost(relay){
        return `${relay.relayUrl}/envelopes`;
    }

    static optionsEnvelopesPost(envelopeBytes){
        return {...postOptions, body: envelopeBytes};
    }

}

const postOptions = {
    method: "POST",
    headers: {
    "Content-Type":
        "application/octet-stream",
    },
}; 