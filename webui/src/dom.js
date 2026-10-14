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

export function downloadBytes(bytes, filename, mime = "") {

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));

  h("a", { href: url, download: filename }).click();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
