import { h } from "../dom.js";
import { peerHue } from "../format.js";

// A round badge colored by the peer's key: the label's first character, or
// the key's first two hex digits when the peer has no label.
export function avatar(publicKeyHex, label) {

  const text = label ? [...label.trim()][0] ?? "?" : publicKeyHex.slice(0, 2);

  return h("span", {
    class: label ? "avatar" : "avatar mono",
    "aria-hidden": "true",
    style: `--hue: ${peerHue(publicKeyHex)}`,
  }, text);
}
