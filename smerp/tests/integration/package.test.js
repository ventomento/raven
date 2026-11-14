import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Packs the package and extracts it where a consumer's install would put it.
async function packAndInstall(t) {

    const dir = mkdtempSync(join(tmpdir(), "raven-package-"));

    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const { stdout } = await run("npm", ["pack", "--json", "--pack-destination", dir], { cwd: ROOT });

    const [{ name, filename, files }] = JSON.parse(stdout);

    const installed = join(dir, "node_modules", ...name.split("/"));

    mkdirSync(installed, { recursive: true });

    await run("tar", ["-xzf", join(dir, filename.replace("/", "-").replace(/^@/, "")), "-C", installed, "--strip-components=1"]);

    return { dir, installed, name, paths: files.map(file => file.path) };
}

test("the tarball holds the library and nothing for development", async t => {

    const { paths } = await packAndInstall(t);

    for (const path of ["LICENSE", "README.md", "package.json", "index.js", "index.d.ts", "docs/smep_rfc.txt", "docs/smerp_rfc.txt", "docs/auth_rfc.txt"]) {
        assert.ok(paths.includes(path), `${path} is missing`);
    }

    const development = paths.filter(path => /(^|\/)tests\/|^playground\/|\/demo\/|^CLAUDE\.md$|\.html$/.test(path));

    assert.deepEqual(development, []);

    const notCode = paths.filter(path => /^(smep|smerp|webui)\/src\//.test(path) && !/\.js$|\.d\.ts$/.test(path));

    assert.deepEqual(notCode, []);
});

test("every exports target is in the tarball and every entry point imports from it", async t => {

    const { dir, installed, name } = await packAndInstall(t);

    const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));

    for (const target of Object.values(pkg.exports)) {
        for (const file of typeof target === "string" ? [target] : Object.values(target)) {
            assert.ok(existsSync(join(installed, file)), `${file} is missing`);
        }
    }

    const script = join(dir, "consumer.mjs");

    const specifiers = Object.keys(pkg.exports)
        .filter(entry => entry !== "./package.json")
        .map(entry => entry === "." ? name : `${name}/${entry.slice(2)}`);

    writeFileSync(script, specifiers.map(specifier => `await import(${JSON.stringify(specifier)});`).join("\n"));

    await run(process.execPath, [script], { cwd: dir });
});
