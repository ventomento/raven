// webui/src/dom.js
//
// DOM building helpers. Content is only ever set as text, never parsed as
// HTML: message plaintext comes from untrusted peers.

/**
 * Create an element.
 *
 *   h("button", { class: "primary", onclick: fn, disabled: true }, "Send")
 *
 * props: "class" sets className, "on<event>" adds a listener, keys that are
 * element properties (value, checked, disabled, hidden, type, ...) are set
 * as properties, anything else as an attribute. null/false props are skipped.
 * children: strings, numbers, nodes or arrays of them; null/false skipped.
 */
export function h(tag, props = {}, ...children) {

  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {

    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (key === "class") {
      el.className = value;
    }
    else if (key.startsWith("on")) {
      el.addEventListener(key.slice(2), value);
    }
    else if (key in el) {
      el[key] = value;
    }
    else {
      el.setAttribute(key, value === true ? "" : value);
    }
  }

  append(el, children);

  return el;
}

/** Replace all children of el. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function append(el, children) {

  for (const child of children.flat(Infinity)) {

    if (child === null || child === undefined || child === false) {
      continue;
    }

    el.append(child instanceof Node ? child : String(child));
  }
}

/** Save bytes (Uint8Array or string) as a file through the browser's download. */
export function downloadBytes(bytes, filename, mime = "") {

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));

  h("a", { href: url, download: filename }).click();

  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Wrap fn so that any number of calls within one animation frame run it
 * once. Sync delivers events in bursts; this keeps it to one render.
 */
export function perFrame(fn) {

  let pending = false;

  return () => {

    if (pending) {
      return;
    }

    pending = true;

    requestAnimationFrame(() => {
      pending = false;
      fn();
    });
  };
}
