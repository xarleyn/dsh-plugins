/**
 * Package gate for @yadsh/dsh-cas-results (guidelines §4, §6.3).
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
assert.match(packageJson.name, /^@yadsh\/dsh-cas-results$/);
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
assert.equal(packageJson.license, "MIT");
assert.equal(packageJson.engines.node, compatibility.node);

// Exports: exhaustive public surface.
for (const exportPath of [".", "./package.json"]) {
  assert.ok(
    Object.hasOwn(packageJson.exports, exportPath),
    `package export is missing: ${exportPath}`,
  );
}

// DSH bundle metadata points at the packaged patch; no client surface.
assert.equal(packageJson.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(packageJson.dsh?.client, undefined);
for (const required of [
  "lib",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "SPEC.md",
  "NOTICE.md",
  "LICENSE",
]) {
  assert.ok(packageJson.files.includes(required), `files is missing: ${required}`);
}

// Canonical bundle patch pair (guidelines §4.3).
assert.match(patch, /# The DSH plugin manager discovers this bundle through package\.json\./);
assert.match(patch, /id: dsh-cas-results\b/);
assert.match(patch, /name: "@yadsh\/dsh-cas-results"/);

// Compatibility manifest (guidelines §7).
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
assert.ok(compatibility.deepseekHarness?.requiredHostFeatures?.includes("tools/post-execute"));

// Attribution contract of the plugin (SPEC §2, §33 AC12).
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(readme, /## Credits/);
assert.match(readme, /dsh-funnel/);
assert.match(readme, /YuanyuanMa03/);
const notice = await readFile(new URL("../NOTICE.md", import.meta.url), "utf8");
assert.match(notice, /dsh-funnel/);
assert.match(notice, /YuanyuanMa03/);

// Docs.
await readFile(new URL("../SPEC.md", import.meta.url), "utf8");

console.log("verify-package: all gates passed");
