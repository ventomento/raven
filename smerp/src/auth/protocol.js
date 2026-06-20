import { PrivateIdentity,  PublicIdentity, insist } from "../../../smep/src/index.js";
import { deriveSharedSecret } from "../../../smep/src/crypto/x25519.js";
import { deriveHmacKey } from "../../../smep/src/crypto/kdf.js";
import { hmacSha256, verifyHmacSha256 } from "../../../smep/src/crypto/hmac.js";
import { bytesToHex, hexToBytes } from "../../../smep/src/encoding/hex.js";
import { encodeUtf8 } from "../../../smep/src/encoding/utf8.js";

export async function symHmacKey({
    privateIdentity, 
    publicIdentity
}) {

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
        
    return makeHeaders(timestamp, bytesToHex(signature));

}

export function makeHeaders(timestamp, signature) {
    
    return {
        "x-smerp-timestamp": timestamp,
        "x-smerp-signature": signature
    };

}

export async function verify({
    privateIdentity,
    publicIdentity,
    dataHex,
    signatureHex    
}) {

    const symKey = await symHmacKey({
        privateIdentity,
        publicIdentity
    })

    const data = hexToBytes(dataHex);
    const signature = hexToBytes(signatureHex);

    return await verifyHmacSha256(
        symKey,
        data,
        signature
    );
}