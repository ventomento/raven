import { encodeUtf8, decodeUtf8 } from "./utf8";

export function encodePlaintext(plaintext){
  let plaintextBytes;

  if (typeof plaintext === "string") {
    plaintextBytes =
      encodeUtf8(plaintext);
      
  } else if (plaintext instanceof Uint8Array ) {
    plaintextBytes = plaintext;
    
  } else {
    throw new Error(
      "plaintext must be string or Uint8Array"
    );
    
  }

  return plaintextBytes;
}

export function decodePlaintext(plaintext){
  let data = plaintext;

  if (
    envelope.content_type ===
    ContentTypes.TEXT_UTF8
  ) {

    data = decodeUtf8(
      plaintext
    );
  }

  return data;
}