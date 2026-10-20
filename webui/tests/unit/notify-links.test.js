import test from "node:test";
import assert from "node:assert/strict";

import { ntfyAppLink, isDefaultNtfyServer } from "../../src/notify-links.js";

const TOPIC = "raven-7393d61a4b43bc37bd434fd736f061f4";

test("ntfyAppLink: host and topic, with the display name when there is one", () => {

  assert.equal(ntfyAppLink("https://ntfy.sh", TOPIC), `ntfy://ntfy.sh/${TOPIC}`);
  assert.equal(ntfyAppLink("https://ntfy.sh", TOPIC, "Alice Æ"), `ntfy://ntfy.sh/${TOPIC}?display=Alice+%C3%86`);
});

test("ntfyAppLink: keeps the port, and tells the app to use http for an http server", () => {

  assert.equal(
    ntfyAppLink("http://localhost:8090", TOPIC, "Bob"),
    `ntfy://localhost:8090/${TOPIC}?display=Bob&secure=false`
  );
});

test("isDefaultNtfyServer: only https://ntfy.sh", () => {

  assert.equal(isDefaultNtfyServer("https://ntfy.sh"), true);
  assert.equal(isDefaultNtfyServer("https://ntfy.sh/"), true);
  assert.equal(isDefaultNtfyServer("http://ntfy.sh"), false);
  assert.equal(isDefaultNtfyServer("https://ntfy.example.com"), false);
});
