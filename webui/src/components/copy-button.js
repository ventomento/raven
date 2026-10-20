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
