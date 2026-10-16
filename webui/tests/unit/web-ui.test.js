import test from "node:test";
import assert from "node:assert/strict";

import { WebUi } from "../../src/web-ui.js";

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

test("injectStylesheet defaults to true", t => {

    withHtmlElement(t);

    const ui = new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root: new FakeElement() });

    assert.equal(ui.injectStylesheet, true);
    assert.equal(ui.stylesheet, null);
});

test("injectStylesheet: false is kept", t => {

    withHtmlElement(t);

    const ui = new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root: new FakeElement(), injectStylesheet: false });

    assert.equal(ui.injectStylesheet, false);
});

test("a non-boolean injectStylesheet is rejected", t => {

    withHtmlElement(t);

    for (const injectStylesheet of ["false", 0, 1, {}, null]) {
        assert.throws(
            () => new WebUi({ privateKeyHex: PRIVATE_KEY_HEX, root: new FakeElement(), injectStylesheet }),
            Error,
        );
    }
});
