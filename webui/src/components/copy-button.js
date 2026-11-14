/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { h } from "../dom.js";

// A "Copy" button that writes getText()'s result to the clipboard and says
// how it went for a moment. The clipboard API needs HTTPS or localhost.
export function copyButton(getText) {

  const button = h("button", {
    class: "ghost",
    type: "button",
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(await getText());
        button.textContent = "Copied";
      }
      catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    },
  }, "Copy");

  return button;
}
