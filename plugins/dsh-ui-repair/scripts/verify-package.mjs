import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

assert.equal(manifest.name, "@yadsh/dsh-ui-repair");
assert.equal(manifest.dsh?.client?.platform, "web");
for (const exportPath of [".", "./client", "./types", "./package.json"]) {
  assert.ok(Object.hasOwn(manifest.exports, exportPath), `missing export ${exportPath}`);
}
for (const file of [
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "CHANGELOG.md",
  "INVESTIGATE.md",
  "LICENSE",
]) {
  assert.ok(manifest.files.includes(file), `${file} is not published`);
  await access(new URL(`../${file}`, import.meta.url));
}
for (const builtFile of ["lib/index.js", "lib/client.js", "lib/types/index.d.ts"]) {
  await access(new URL(`../${builtFile}`, import.meta.url));
}

process.stdout.write("verify-package: manifest and built exports passed\n");
