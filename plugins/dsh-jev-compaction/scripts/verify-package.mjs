import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const patch = await readFile(
  new URL("../cordis.patch.yml", import.meta.url),
  "utf8",
);

assert.equal(manifest.name, "@yadsh/dsh-jev-compaction");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.ok(Object.hasOwn(manifest.exports, "."));
assert.match(patch, /id: dsh-jev-compaction\b/u);
assert.match(patch, new RegExp(`name: ['"]${manifest.name}['"]`, "u"));

for (const path of [
  "../lib/index.js",
  "../lib/index.d.ts",
  "../README.md",
  "../LICENSE",
]) {
  await access(new URL(path, import.meta.url));
}

console.log("verify-package: all gates passed");
