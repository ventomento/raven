/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const NOTICE = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
`;

function sourceFiles(dir) {

    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {

        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            return sourceFiles(path);
        }

        return /\.js$|\.d\.ts$/.test(entry.name) ? [path] : [];
    });
}

// MPL-2.0 applies per file, so a file copied elsewhere must keep its terms.
test("every shipped source file starts with the MPL notice", () => {

    const files = [
        join(ROOT, "index.js"),
        join(ROOT, "index.d.ts"),
        ...["smep/src", "smerp/src", "webui/src"].flatMap(dir => sourceFiles(join(ROOT, dir))),
    ];

    const missing = files.filter(file => !readFileSync(file, "utf8").startsWith(NOTICE));

    assert.deepEqual(missing.map(file => relative(ROOT, file)), []);
});

test("package.json and LICENSE name the same license", () => {

    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

    assert.equal(pkg.license, "MPL-2.0");
    assert.ok(readFileSync(join(ROOT, "LICENSE"), "utf8").startsWith("Mozilla Public License Version 2.0"));
});
