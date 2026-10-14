export function shortHex(hex, head = 8, tail = 4) {

  if (typeof hex !== "string" || hex.length <= head + tail + 1) {
    return hex ?? "";
  }

  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function peerLabel({ publicKeyHex, name }, ownPublicKeyHex) {

  if (name) {
    return name;
  }

  return publicKeyHex === ownPublicKeyHex ? "Note to self" : null;
}

export function formatTime(ms, now = Date.now()) {

  if (!ms) {
    return "never";
  }

  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (date.toDateString() === new Date(now).toDateString()) {
    return time;
  }

  return `${date.toLocaleDateString()} ${time}`;
}

export function formatBytes(n) {

  if (n < 1024) {
    return `${n} B`;
  }

  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }

  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function parsePublicKeyHex(value) {
  const hex = value.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}
