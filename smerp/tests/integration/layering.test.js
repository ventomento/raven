import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// What each shipped layer may import from outside itself: smerp depends on
// smep, webui on both, and nobody reaches past another layer's index.
const LAYERS = {
    "smep/src": [],
    "smerp/src": ["smep/src/index.js", "smep/src/internal.js"],
    "webui/src": ["index.js", "smep/src/index.js", "smep/src/internal.js", "smerp/src/index.js"],
};

const ROOT_ENTRY_MAY_IMPORT = ["smep/src/index.js", "smerp/src/index.js"];

function sourceFiles(dir) {

    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {

        const path = join(dir, entry.name);

        if (entry.isDirectory()) {
            return sourceFiles(path);
        }

        return entry.name.endsWith(".js") ? [path] : [];
    });
}

function importsOf(file) {

    const source = readFileSync(file, "utf8");

    return [...source.matchAll(/\bfrom\s+"([^"]+)";?\s*$|^import\s+"([^"]+)";?\s*$|\bimport\("([^"]+)"\)/gm)]
        .map(match => match[1] ?? match[2] ?? match[3]);
}

function outsideImports(file, layer) {

    return importsOf(file)
        .filter(specifier => specifier.startsWith("."))
        .map(specifier => relative(ROOT, resolve(dirname(file), specifier)).replaceAll("\\", "/"))
        .filter(target => !target.startsWith(`${layer}/`));
}

for (const [layer, allowed] of Object.entries(LAYERS)) {

    test(`${layer} imports only what it may from other layers`, () => {

        const files = sourceFiles(join(ROOT, layer));

        assert.ok(files.length > 0);

        for (const file of files) {
            for (const target of outsideImports(file, layer)) {
                assert.ok(allowed.includes(target), `${relative(ROOT, file)} imports ${target}`);
            }
        }
    });

    test(`${layer} runs in a browser: no node: imports or bare packages`, () => {

        for (const file of sourceFiles(join(ROOT, layer))) {
            for (const specifier of importsOf(file)) {
                assert.ok(specifier.startsWith("."), `${relative(ROOT, file)} imports ${specifier}`);
            }
        }
    });
}

test("the root entry point goes through the layers' indexes", () => {

    const targets = outsideImports(join(ROOT, "index.js"), "");

    assert.deepEqual([...new Set(targets)].sort(), ROOT_ENTRY_MAY_IMPORT);
});
