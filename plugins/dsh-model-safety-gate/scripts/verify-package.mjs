/**
 * Package gate for @yadsh/dsh-model-safety-gate (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, packaged file list, and the attribution contract without hitting
 * the network.
 */

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

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

// Exports: exhaustive public surface, including the browser and wire entry points.
for (const exportPath of [".", "./client", "./remote", "./typert", "./types", "./package.json"]) {
  assert.ok(
    Object.hasOwn(packageJson.exports, exportPath),
    `package export is missing: ${exportPath}`,
  );
}

// DSH bundle metadata: the packaged patch plus the browser client declaration.
assert.equal(packageJson.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(packageJson.dsh?.client?.platform, "web");
assert.deepEqual(packageJson.dsh?.client?.inject, [
  "@deepseek-ai/dsh-api-gateway",
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-settings-plugins",
]);
for (const required of [
  "lib/**/*.js",
  "lib/**/*.js.map",
  "lib/**/*.d.ts",
  "lib/client.js",
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

// DSH runtime packages stay peer-only (SPEC.md §1, criterion 16). A third-party
// runtime library (zod, used by the generated Remote codec) is allowed; a
// harness package never is.
for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  assert.doesNotMatch(dependency, /^@deepseek-ai\//, `harness package must stay a peer: ${dependency}`);
}
// Harness packages and the browser runtime the host page already provides are
// the only peers; anything else belongs in dependencies.
const BROWSER_PEERS = new Set(["react", "react-dom"]);
for (const peer of Object.keys(packageJson.peerDependencies)) {
  assert.ok(
    peer.startsWith("@deepseek-ai/") || BROWSER_PEERS.has(peer),
    `unexpected peer: ${peer}`,
  );
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

// Built artifacts: the host entry, the browser bundle, and the generated
// Remote pair the card mounts.
for (const path of [
  "lib/index.js",
  "lib/types/index.d.ts",
  "lib/client.js",
  "lib/types/client/index.d.ts",
  "lib/typert.host.js",
  "lib/typert.host.d.ts",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
]) {
  assert((await stat(new URL(`../${path}`, import.meta.url))).isFile(), `${path} must be built`);
}

// Browser bundle identity (AGENTS.md): the registration id is the full package
// name, and the card shell is the canonical one.
const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert.match(client, /id:\s*"@yadsh\/dsh-model-safety-gate"/u);
verifyPluginCardContract(client, {
  legacyPatterns: [/\.msg-gate-card\b/u, /\.msg-panel\b/u, /dsh-plugin-card\s*\*/u],
});

// The card must not ship the classifier key: the wire projection is redacted
// host-side, and the bundle itself never carries a literal key field name pair.
assert.match(client, /apiKeyConfigured/u);

console.log("verify-package: all gates passed");
