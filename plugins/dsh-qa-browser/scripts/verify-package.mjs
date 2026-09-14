import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const patch = await readFile(
  new URL("../cordis.patch.yml", import.meta.url),
  "utf8",
);

assert.equal(manifest.name, "@yadsh/dsh-qa-browser");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.scripts?.postinstall, undefined);
assert.equal(manifest.dependencies?.playwright, "catalog:tooling");
assert.match(patch, /id: dsh-qa-browser\b/u);
assert.match(patch, /name: "@yadsh\/dsh-qa-browser"/u);

for (const path of [
  "../lib/index.js",
  "../lib/index.d.ts",
  "../lib/types.js",
  "../lib/types.d.ts",
  "../README.md",
  "../LICENSE",
]) {
  await access(new URL(path, import.meta.url));
}

const built = await import("../lib/index.js");
assert.equal(built.name, "dsh-qa-browser");
assert.equal(built.default, built.QaBrowserService);
assert.equal(built.QA_BROWSER_DEFAULTS.runtime.provider, "playwright");

console.log("verify-package: all gates passed");
