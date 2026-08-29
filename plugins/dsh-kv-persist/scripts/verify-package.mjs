/**
 * Package gate for @yadsh/dsh-kv-persist (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, and packaged file list without hitting the network.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");

// Manifest identity.
assert.match(packageJson.name, /^@yadsh\/dsh-kv-persist$/);
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
assert.equal(packageJson.license, "MIT");

// Exports: exhaustive public surface.
for (const exportPath of [".", "./package.json"]) {
  assert.ok(
    Object.hasOwn(packageJson.exports, exportPath),
    `package export is missing: ${exportPath}`,
  );
}

// DSH bundle metadata points at the packaged patch.
assert.equal(packageJson.dsh?.bundle?.patch, "./cordis.patch.yml");
for (const required of [
  "lib",
  "cordis.patch.yml",
  "compatibility.json",
  "docs/dsh-kv-persist.md",
  "README.md",
  "LICENSE",
]) {
  assert.ok(packageJson.files.includes(required), `files is missing: ${required}`);
}

// Canonical bundle patch pair (guidelines §4.3).
assert.match(patch, /# The DSH plugin manager discovers this bundle through package\.json\./);
assert.match(patch, /id: dsh-kv-persist\b/);
assert.match(patch, /name: "@yadsh\/dsh-kv-persist"/);

// Compatibility manifest (guidelines §7).
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
assert.ok(compatibility.node?.length > 0);

// Docs.
await readFile(new URL("../README.md", import.meta.url), "utf8");
await readFile(new URL("../SPEC.md", import.meta.url), "utf8");

console.log("verify-package: all gates passed");
