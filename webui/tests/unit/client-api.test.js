import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { SmerpClient, PrivateIdentity } from "../../../index.js";
import { FakeClient } from "../helpers/fake-client.js";

const SRC = new URL("../../src/", import.meta.url).pathname;

async function sourceFiles(dir) {

    const files = [];

    for (const entry of await readdir(dir, { withFileTypes: true })) {

        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await sourceFiles(path));
        }
        else if (entry.name.endsWith(".js")) {
            files.push(path);
        }
    }

    return files;
}

async function clientMembers() {

    const client = new SmerpClient({ identity: await PrivateIdentity.generate() });

    return new Set([
        ...Object.getOwnPropertyNames(SmerpClient.prototype),
        ...Object.keys(client),
    ]);
}

test("everything the webui uses on its client exists on SmerpClient", async () => {

    const members = await clientMembers();
    const used = new Set();

    for (const file of await sourceFiles(SRC)) {
        for (const [, name] of (await readFile(file, "utf8")).matchAll(/\bclient\.(\w+)/g)) {
            used.add(name);
        }
    }

    assert.ok(used.size > 5, "found the client calls");
    assert.deepEqual([...used].filter(name => !members.has(name)), []);
});

test("the fake client offers nothing the real one lacks", async () => {

    const members = await clientMembers();
    const fakeOnly = new Set(["record", "callsTo", "emit", "listenerCount", "storage", "calls", "listeners", "sendError", "sendResult"]);

    const fake = new FakeClient();
    const offered = [
        ...Object.getOwnPropertyNames(FakeClient.prototype),
        ...Object.keys(fake),
    ].filter(name => name !== "constructor" && !fakeOnly.has(name));

    assert.deepEqual(offered.filter(name => !members.has(name)), []);
});
