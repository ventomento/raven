// A happy-dom window as the global DOM, for the webui tests. Import it
// first in every webui test file that touches the DOM; each test file
// runs in its own process, so each gets its own window.

import { after } from "node:test";
import { Window } from "happy-dom";

export const window = new Window({
    url: "http://localhost/",
    settings: {
        // WebUi injects its stylesheet with a <link>; not loading it
        // fires "error", which WebUi takes as loaded.
        disableCSSFileLoading: true,
        disableJavaScriptFileLoading: true,
    },
});

export const document = window.document;

for (const name of [
    "window",
    "document",
    "navigator",
    "Node",
    "HTMLElement",
    "Event",
    "KeyboardEvent",
    "SubmitEvent",
]) {
    Object.defineProperty(globalThis, name, {
        value: name === "window" ? window : window[name],
        configurable: true,
        writable: true,
    });
}

// Frames run on the next turn of the event loop; settle() waits for them.
globalThis.requestAnimationFrame = (callback) => setImmediate(() => callback(performance.now()));

after(() => window.happyDOM.close());

/**
 * Let pending work run: animation frames, event-bus microtasks and the
 * async renders they start (a few turns of the event loop).
 */
export async function settle(turns = 10) {

    for (let i = 0; i < turns; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

/** Wait until check() is truthy, letting the event loop turn. */
export async function until(check, { timeoutMs = 5000, message = "condition" } = {}) {

    const end = Date.now() + timeoutMs;

    while (!(await check())) {

        if (Date.now() > end) {
            throw new Error(`until: timed out waiting for ${message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

/** A fresh container element attached to the document. */
export function container() {

    const el = document.createElement("div");
    document.body.append(el);

    return el;
}

/** The text of el with whitespace collapsed. */
export const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The first button under el whose text contains label. */
export function button(el, label) {
    return [...el.querySelectorAll("button")].find(b => b.textContent.includes(label)) ?? null;
}

/** Dispatch a submit event on form, as pressing a submit button does. */
export function submit(form) {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

/** Set an input's files, as a user picking them would. */
export function setFiles(input, files) {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new window.Event("change"));
}
