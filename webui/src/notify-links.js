// Links for subscribing a phone to a conversation's ntfy topic. DOM-free.

export const DEFAULT_NTFY_URL = "https://ntfy.sh";

// The ntfy Android app's deep link: opens the app and subscribes in one step.
// display names the subscription; secure=false makes the app use http.
export function ntfyAppLink(ntfyUrl, topic, displayName = "") {

  const url = new URL(ntfyUrl);
  const params = new URLSearchParams();

  if (displayName) {
    params.set("display", displayName);
  }

  if (url.protocol === "http:") {
    params.set("secure", "false");
  }

  const query = params.toString();

  return `ntfy://${url.host}/${topic}${query ? `?${query}` : ""}`;
}

// ntfy.sh is the app's default server: only another server needs "Use
// another server" in the iOS app.
export function isDefaultNtfyServer(ntfyUrl) {
  return new URL(ntfyUrl).origin === DEFAULT_NTFY_URL;
}
