import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");

assert.equal(manifest.name, "@yadsh/dsh-user-correction-miner");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dependencies?.["@yadsh/dsh-plugin-log"], "workspace:^");
assert.ok(Object.hasOwn(manifest.exports, "."));
assert.ok(Object.hasOwn(manifest.exports, "./package.json"));
assert.match(patch, /id: dsh-user-correction-miner\b/u);
assert.match(patch, /name: "@yadsh\/dsh-user-correction-miner"/u);
assert.ok(compatibility.deepseekHarness.requiredHostFeatures.includes("session-query"));
assert.ok(compatibility.deepseekHarness.requiredHostFeatures.includes("storage-domain"));

for (const path of ["../lib/index.js", "../lib/index.d.ts", "../README.md", "../LICENSE"]) {
  await access(new URL(path, import.meta.url));
}

console.log("verify-package: all gates passed");
