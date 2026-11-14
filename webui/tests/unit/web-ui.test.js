import test from "node:test";
import assert from "node:assert/strict";

import { WebUi } from "../../src/web-ui.js";
import { WEBUI_CSS } from "../../src/styles/webui.css.js";

const PRIVATE_KEY_HEX = "11".repeat(32);

class FakeElement {}

function withHtmlElement(t) {

    const original = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");

    Object.defineProperty(globalThis, "HTMLElement", { value: FakeElement, configurable: true, writable: true });

    t.after(() => {
        if (original) {
            Object.defineProperty(globalThis, "HTMLElement", original);
        }
        else {
            delete globalThis.HTMLElement;
        }
    });
}

test("a new WebUi has no stylesheet until it starts", t => {

    withHtmlElement(t);

    const ui = new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root: new FakeElement() });

    assert.equal(ui.stylesheet, null);
});

test("the stylesheet ships as a JS string that styles .webui", () => {

    assert.equal(typeof WEBUI_CSS, "string");
    assert.match(WEBUI_CSS, /^\.webui \{/m);
});

test("notify and ntfyUrl are checked and kept for the client", t => {

    withHtmlElement(t);

    const root = new FakeElement();
    const defaults = new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root });

    assert.equal(defaults.notify, false);
    assert.equal(defaults.ntfyUrl, null);

    const set = new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root, notify: true, ntfyUrl: "http://localhost:8090" });

    assert.equal(set.notify, true);
    assert.equal(set.ntfyUrl, "http://localhost:8090");

    assert.throws(() => new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root, notify: "yes" }));
    assert.throws(() => new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root, ntfyUrl: 42 }));
});
