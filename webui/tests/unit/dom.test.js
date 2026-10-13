import { document, settle } from "../helpers/dom-env.js";

import test from "node:test";
import assert from "node:assert/strict";

import { h, replaceChildren, perFrame } from "../../src/dom.js";

test("h: class, listeners, properties and attributes", () => {

    let clicked = 0;

    const el = h("input", {
        class: "a b",
        onclick: () => clicked++,
        value: "v",
        disabled: true,
        "data-x": "1",
        "aria-label": "label",
        required: false,
        placeholder: null,
    });

    assert.equal(el.tagName, "INPUT");
    assert.equal(el.className, "a b");
    assert.equal(el.value, "v");
    assert.equal(el.disabled, true);
    assert.equal(el.getAttribute("data-x"), "1");
    assert.equal(el.getAttribute("aria-label"), "label");
    assert.equal(el.hasAttribute("required"), false);
    assert.equal(el.hasAttribute("placeholder"), false);

    const enabled = h("button", { onclick: () => clicked++ });
    enabled.click();
    assert.equal(clicked, 1);
});

test("h: true attributes are set empty", () => {

    assert.equal(h("div", { "data-flag": true }).getAttribute("data-flag"), "");
});

test("h: children are text, nodes, numbers and nested arrays; null and false skipped", () => {

    const el = h("div", {}, "a", 1, null, false, undefined, [h("b", {}, "c"), ["d"]]);

    assert.equal(el.textContent, "a1cd");
    assert.equal(el.querySelector("b").textContent, "c");
});

test("h: markup in text stays text", () => {

    const hostile = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const el = h("div", {}, hostile);

    assert.equal(el.textContent, hostile);
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector("script"), null);
    assert.equal(el.children.length, 0);
});

test("replaceChildren swaps all children", () => {

    const el = h("ul", {}, h("li", {}, "old"));

    replaceChildren(el, [h("li", {}, "1"), h("li", {}, "2")]);

    assert.deepEqual([...el.children].map(li => li.textContent), ["1", "2"]);
});

test("perFrame runs once per frame however often it is called", async () => {

    let runs = 0;
    const render = perFrame(() => runs++);

    render();
    render();
    render();
    assert.equal(runs, 0, "waits for the frame");

    await settle();
    assert.equal(runs, 1);

    render();
    await settle();
    assert.equal(runs, 2);
});
