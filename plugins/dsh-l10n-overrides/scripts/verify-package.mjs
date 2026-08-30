import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

for (const exportPath of [".", "./client", "./types", "./package.json"]) {
  assert.ok(
    Object.hasOwn(packageJson.exports, exportPath),
    `package export is missing: ${exportPath}`,
  );
}

assert.equal(packageJson.dsh?.client?.platform, "web");
assert.deepEqual(packageJson.dsh?.client?.inject, [
  "@deepseek-ai/dsh-client-locale",
]);

for (const publishedFile of [
  "cordis.patch.yml",
  "README.md",
  "ROADMAP.md",
  "LICENSE",
]) {
  assert.ok(
    packageJson.files.includes(publishedFile),
    `published file is missing from package.json: ${publishedFile}`,
  );
  await access(new URL(`../${publishedFile}`, import.meta.url));
}
