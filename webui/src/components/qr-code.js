import { h } from "../dom.js";
import { qrMatrix } from "../qr.js";

const QUIET_ZONE = 4;
const MODULE_PX = 4;

// A QR code on a canvas, black on white with the quiet zone the spec asks
// for, whatever the theme: scanners expect dark modules on light.
export function qrCode(text, label) {

  const matrix = qrMatrix(text);
  const size = (matrix.length + QUIET_ZONE * 2) * MODULE_PX;

  const canvas = h("canvas", {
    class: "qr",
    width: size,
    height: size,
    role: "img",
    "aria-label": label,
  });

  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#000000";

  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        context.fillRect((x + QUIET_ZONE) * MODULE_PX, (y + QUIET_ZONE) * MODULE_PX, MODULE_PX, MODULE_PX);
      }
    });
  });

  return canvas;
}
