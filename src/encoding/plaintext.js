import { encodeUtf8 } from "./utf8.js";

export function encodePlaintext(plaintext){
  let plaintextBytes;

  if (typeof plaintext === "string") {
    plaintextBytes = encodeUtf8(plaintext);
      
  } else if (plaintext instanceof Uint8Array ) {
    plaintextBytes = plaintext;
    
  } else {
    throw new Error(
      "plaintext must be string or Uint8Array"
    );
    
  }

  return plaintextBytes;
}