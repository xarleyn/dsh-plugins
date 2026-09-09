/**
 * Package gate for @yadsh/dsh-model-safety-gate (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, packaged file list, and the attribution contract without hitting
 * the network.
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
assert.match(packageJson.name, /^@yadsh\/dsh-model-safety-gate$/);
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

// DSH bundle metadata points at the packaged patch; no client surface in 0.1.
assert.equal(packageJson.dsh?.bundle?.patch, "./cordis.patch.yml");
for (const required of [
  "lib",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "SPEC.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
]) {
  assert.ok(packageJson.files.includes(required), `files is missing: ${required}`);
}

// DSH runtime packages stay peer-only (SPEC.md §1, criterion 16).
for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  assert.match(dependency, /^@yadsh\//, `non-workspace runtime dependency: ${dependency}`);
}
for (const peer of Object.keys(packageJson.peerDependencies)) {
  assert.match(peer, /^@deepseek-ai\//, `unexpected peer: ${peer}`);
}

// Canonical bundle patch pair (guidelines §4.3).
assert.match(patch, /# The DSH plugin manager discovers this bundle through package\.json\./);
assert.match(patch, /id: dsh-model-safety-gate\b/);
assert.match(patch, /name: "@yadsh\/dsh-model-safety-gate"/);

// Compatibility manifest (guidelines §7): the four guarded extension points.
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
for (const feature of ["agent/pre-step", "llm/stream", "tools/pre-execute", "tools/post-execute"]) {
  assert.ok(
    compatibility.deepseekHarness?.requiredHostFeatures?.includes(feature),
    `requiredHostFeatures is missing: ${feature}`,
  );
}

// Attribution contract of the plugin (design SPEC §2).
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(readme, /NOTICE\.md/);
const notice = await readFile(new URL("../NOTICE.md", import.meta.url), "utf8");
for (const upstream of ["dsh-defend", "PerryLink", "dsh-run-guard", "dsh-autogate", "dsh-secure-audit", "dsh-injection-guard"]) {
  assert.ok(notice.includes(upstream), `NOTICE.md is missing attribution: ${upstream}`);
}
const thirdParty = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
assert.match(thirdParty, /Apache-2\.0/);
assert.match(thirdParty, /bundles no third-party source/);

// Docs: SPEC.md product contract present and status table honest.
const spec = await readFile(new URL("../SPEC.md", import.meta.url), "utf8");
assert.match(spec, /## 1\. Product contract/);
assert.match(spec, /## 6\. Implementation status/);

console.log("verify-package: all gates passed");
