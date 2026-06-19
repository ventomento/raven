import { PrivateIdentity,  PublicIdentity, insist } from "../../../smep/src/index.js";
import { deriveSharedSecret } from "../../../smep/src/crypto/x25519";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf";

export async function symHmacKey(
    privateIdentity, 
    publicIdentity
) {

    insist(privateIdentity, PrivateIdentity);
    insist(publicIdentity, PublicIdentity);
    
    const sharedSecret = await deriveSharedSecret(
        privateIdentity.privateKey,
        publicIdentity.publicKey
    );

    return await deriveHmacKey(
        sharedSecret
    );

}

function getTimestamp() {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const timestampEncoded = encodeUtf8(timestamp);

    return {timestamp, timestampEncoded};
}

export async function signedHeaders(hmacKey){
        
    const {timestamp, timestampEncoded} = getTimestamp();
    
    const signature = await hmacSha256(
        hmacKey,
        timestampEncoded
    );
        
    return makeHeaders(timestamp, signature);

}

function makeHeaders(timestamp, signature) {
    
    return {
        "x-smerp-timestamp": timestamp,
        "x-smerp-signature": signature
    };

}

export function verify() {

}