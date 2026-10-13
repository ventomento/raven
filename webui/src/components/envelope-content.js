// webui/src/components/envelope-content.js

import { ContentTypes } from "../../../index.js";
import { decodeUtf8 } from "../../../smep/src/index.js";
import { h, downloadBytes } from "../dom.js";
import { formatBytes } from "../format.js";
import { detectFileType } from "../file-type.js";

/**
 * The body of one envelope: text for TEXT_UTF8, a download button for
 * anything else. The protocol carries no filename or MIME type, so the
 * extension is guessed from the file's leading bytes, and left off when
 * the format is not recognized.
 */
export function envelopeContent(envelope) {

  const { plaintext, contentType, hash } = envelope;

  if (contentType === ContentTypes.TEXT_UTF8) {
    const text = typeof plaintext === "string" ? plaintext : decodeUtf8(plaintext);
    return h("div", { class: "text" }, text);
  }

  const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
  const fileType = detectFileType(bytes);
  const filename = `smerp-${hash.slice(0, 8)}${fileType ? `.${fileType.ext}` : ""}`;
  const label = fileType ? fileType.ext.toUpperCase() : "file";

  return h("button", {
    class: "download",
    type: "button",
    onclick: () => downloadBytes(bytes, filename, fileType?.mime ?? ""),
  }, `Download ${label} (${formatBytes(bytes.length)})`);
}
