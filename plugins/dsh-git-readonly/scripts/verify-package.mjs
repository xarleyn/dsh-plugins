/**
 * Package gate for @yadsh/dsh-git-readonly (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest, the packaged file list, and the security-contract documentation
 * that deployments rely on, without hitting the network.
 */

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");

// Manifest identity.
assert.equal(manifest.name, "@yadsh/dsh-git-readonly");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.license, "MIT");
assert.equal(manifest.engines.node, compatibility.node);

// Exports: exhaustive public surface.
for (const exportPath of [".", "./package.json"]) {
  assert.ok(Object.hasOwn(manifest.exports, exportPath), `package export is missing: ${exportPath}`);
}

// DSH bundle metadata points at the packaged patch; no client surface.
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh?.client, undefined);

// Canonical bundle patch pair (guidelines §4.3).
assert.match(
  patch,
  /# The DSH plugin manager discovers this bundle through package\.json\./u,
);
assert.match(patch, /id: dsh-git-readonly\b/u);
assert.match(patch, /name: "@yadsh\/dsh-git-readonly"/u);

// Compatibility manifest (guidelines §7).
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
assert.ok(
  compatibility.deepseekHarness?.requiredHostFeatures?.includes("tools/register"),
  "compatibility.json must declare the tools/register host feature",
);

// Files whitelist: docs and license travel with the tarball.
for (const required of [
  "lib",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "SPEC.md",
  "LICENSE",
]) {
  assert.ok(manifest.files.includes(required), `files is missing: ${required}`);
}

for (const path of ["../lib/index.js", "../lib/index.d.ts", "../README.md", "../LICENSE"]) {
  await access(new URL(path, import.meta.url));
}

// Security-contract documentation: the README must name every registered
// tool (deployment allow-lists are built from this list) and must document
// the read-only security model; SPEC.md is the product contract.
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
for (const toolName of ["dsh_git_context", "dsh_git_history", "dsh_git_show", "dsh_git_blame"]) {
  assert.match(readme, new RegExp(toolName, "u"), `README must document ${toolName}`);
}
assert.match(readme, /## Security model/u);
const spec = await readFile(new URL("../SPEC.md", import.meta.url), "utf8");
assert.match(spec, /## 1\. Product contract/u);
assert.match(spec, /## 9\. Mutation test contract/u);

console.log("verify-package: all gates passed");
