/**
 * Package gate for @yadsh/dsh-tool-offload (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, packaged file list, and the attribution contract without
 * hitting the network.
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
assert.match(packageJson.name, /^@yadsh\/dsh-tool-offload$/);
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
assert.match(patch, /id: dsh-tool-offload\b/);
assert.match(patch, /name: "@yadsh\/dsh-tool-offload"/);

// Compatibility manifest (guidelines §7): the plugin requires the
// post-execute reshaping seam and the one-shot subagent service.
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
assert.ok(compatibility.deepseekHarness?.requiredHostFeatures?.includes("tools/post-execute"));
assert.ok(compatibility.deepseekHarness?.requiredHostFeatures?.includes("subagents/start"));

// Safety-critical surface shipped by the build: no-tools worker invariant and
// recursion label must stay part of the compiled runtime (SPEC §6.1, §25).
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

async function jsFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsFilesUnder(path)));
    } else if (entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

const libRoot = fileURLToPath(new URL("../lib/", import.meta.url));
const libFiles = await jsFilesUnder(libRoot);
assert.ok(libFiles.length > 0, "lib build output is missing");
const libText = (await Promise.all(libFiles.map((path) => readFile(path, "utf8")))).join("\n");
assert.ok(libText.includes("dsh-tool-offload:"), "built runtime must keep the worker label prefix");
assert.ok(libText.includes('"subagent"'), "built runtime must reference the delegated-child origin guard");
assert.ok(libText.includes("allow: []"), "built runtime must keep the no-tools worker filter");

// Attribution contract of the plugin (SPEC §28).
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
assert.match(readme, /## Credits/);
assert.match(readme, /portal-ai-plugins\/shunt|Spotify/);
const notice = await readFile(new URL("../NOTICE.md", import.meta.url), "utf8");
assert.match(notice, /Spotify/);
assert.match(notice, /shunt/);

// Docs.
await readFile(new URL("../SPEC.md", import.meta.url), "utf8");

console.log("verify-package: all gates passed");
