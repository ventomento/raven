// webui/src/file-type.js
//
// Guess a file's type from its leading bytes. Envelopes carry no filename
// or MIME type, so this is how a received file gets an extension the OS
// can open. Pure, so it is testable in Node.

// Each signature: bytes that must appear at an offset. Strings are ASCII.
const SIGNATURES = [
  { ext: "png", mime: "image/png", match: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]] },
  { ext: "jpg", mime: "image/jpeg", match: [[0, [0xff, 0xd8, 0xff]]] },
  { ext: "gif", mime: "image/gif", match: [[0, "GIF8"]] },
  { ext: "webp", mime: "image/webp", match: [[0, "RIFF"], [8, "WEBP"]] },
  { ext: "wav", mime: "audio/wav", match: [[0, "RIFF"], [8, "WAVE"]] },
  { ext: "pdf", mime: "application/pdf", match: [[0, "%PDF-"]] },
  { ext: "mp3", mime: "audio/mpeg", match: [[0, "ID3"]] },
  { ext: "ogg", mime: "audio/ogg", match: [[0, "OggS"]] },
  { ext: "flac", mime: "audio/flac", match: [[0, "fLaC"]] },
  { ext: "mp4", mime: "video/mp4", match: [[4, "ftyp"]] },
  { ext: "webm", mime: "video/webm", match: [[0, [0x1a, 0x45, 0xdf, 0xa3]]] },
  { ext: "zip", mime: "application/zip", match: [[0, [0x50, 0x4b, 0x03, 0x04]]] },
  { ext: "gz", mime: "application/gzip", match: [[0, [0x1f, 0x8b]]] },
  { ext: "7z", mime: "application/x-7z-compressed", match: [[0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]]] },
];

/** { ext, mime } for a recognized format, null otherwise. */
export function detectFileType(bytes) {

  for (const { ext, mime, match } of SIGNATURES) {
    if (match.every(([offset, expected]) => startsWith(bytes, offset, expected))) {
      return { ext, mime };
    }
  }

  return null;
}

function startsWith(bytes, offset, expected) {

  if (bytes.length < offset + expected.length) {
    return false;
  }

  for (let i = 0; i < expected.length; i++) {

    const byte = typeof expected === "string" ? expected.charCodeAt(i) : expected[i];

    if (bytes[offset + i] !== byte) {
      return false;
    }
  }

  return true;
}
