/**
 * Package gate for @yadsh/dsh-domain-experts (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest, the packaged file list, the built host and browser artifacts, and
 * the two contracts deployment relies on: the settings tab registration and
 * the enforcement vocabulary the README promises. Runs offline.
 */

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const PACKAGE_NAME = "@yadsh/dsh-domain-experts";
const RUNTIME_ID = "dsh-domain-experts";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);
const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");

// Manifest identity (tarball gate 2 checks the packed copy of the same fields).
assert.equal(manifest.name, PACKAGE_NAME);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
assert.equal(manifest.license, "MIT");
assert.equal(manifest.engines.node, compatibility.node);
assert.equal(
  manifest.repository?.directory,
  "plugins/dsh-domain-experts",
);

// Exports: exhaustive public surface, types mirroring the root entry.
for (const exportPath of [
  ".",
  "./client",
  "./remote",
  "./typert",
  "./types",
  "./package.json",
]) {
  assert.ok(
    Object.hasOwn(manifest.exports, exportPath),
    `package export is missing: ${exportPath}`,
  );
}
assert.equal(manifest.types, manifest.exports["."].types);
assert.equal(manifest.exports["./client"].default, "./lib/client.js");
assert.equal(manifest.exports["./remote"].default, "./lib/typert.remote-client.js");
assert.equal(manifest.exports["./typert"].default, "./lib/typert.host.js");

// DSH bundle metadata.
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh?.client?.platform, "web");
assert.ok(
  manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-settings"),
  "the settings tab slot declaration comes from the settings client package",
);

// Canonical bundle patch pair (guidelines §4.3).
assert.match(
  patch,
  /# The DSH plugin manager discovers this bundle through package\.json\./u,
);
assert.match(patch, new RegExp(`id: ${RUNTIME_ID}\\b`, "u"));
assert.match(patch, /name: "@yadsh\/dsh-domain-experts"/u);

// Compatibility manifest (guidelines §7).
assert.ok(compatibility.deepseekHarness?.range?.length > 0);
assert.ok(Array.isArray(compatibility.deepseekHarness?.testedReleases));
for (const feature of ["tools/register", "subagents.start", "storageDomain.open"]) {
  assert.ok(
    compatibility.deepseekHarness?.requiredHostFeatures?.includes(feature),
    `compatibility.json must declare the ${feature} host feature`,
  );
}
assert.ok(
  compatibility.deepseekHarness?.requiredClientFeatures?.includes("settings.plugins.tab"),
  "compatibility.json must declare the settings.plugins.tab client feature",
);

// Files whitelist: docs and license travel with the tarball.
for (const required of [
  "lib/**/*.js",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "LICENSE",
]) {
  assert.ok(manifest.files.includes(required), `files is missing: ${required}`);
}

// Built artifacts.
for (const path of [
  "../lib/index.js",
  "../lib/types/index.d.ts",
  "../lib/types.js",
  "../lib/types/types.d.ts",
  "../lib/client.js",
  "../lib/client.js.map",
  "../lib/types/client/index.d.ts",
  "../lib/typert.host.js",
  "../lib/typert.host.d.ts",
  "../lib/typert.remote-client.js",
  "../lib/typert.remote-client.d.ts",
  "../README.md",
  "../LICENSE",
]) {
  await access(new URL(path, import.meta.url));
}

// The generated Remote contract exposes the service the client calls.
const remote = await readFile(new URL("../lib/typert.remote-client.js", import.meta.url), "utf8");
for (const method of [
  "domainExperts/listDomains",
  "domainExperts/getDomain",
  "domainExperts/createDomain",
  "domainExperts/updateDomain",
  "domainExperts/resolveScope",
  "domainExperts/inspectMemory",
  "domainExperts/testExpert",
]) {
  assert.match(remote, new RegExp(method.replace("/", "/"), "u"), `remote is missing ${method}`);
}
const hostRemote = await readFile(new URL("../lib/typert.host.js", import.meta.url), "utf8");
assert.match(hostRemote, /domainExperts/u);

/*
 * Browser bundle contract: it registers under the package's full npm name (a
 * scoped path, per AGENTS.md) and contributes a tab, not a configuration
 * card. The negative assertions are the deliberate half: this plugin ships no
 * card shell, so the canonical card CSS must not appear in the bundle.
 */
const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert.match(
  client,
  new RegExp(`__ModuleLoader__\\.load\\(\\{\\s*id:\\s*${JSON.stringify(PACKAGE_NAME)}`, "u"),
  `client bundle must register as ${PACKAGE_NAME}`,
);
assert.match(client, /settings\.plugins\.tab/u, "client bundle must register a settings tab");
assert.match(client, /domain-experts/u, "client bundle must carry the tab id");
assert.match(client, /Domain Experts/u, "client bundle must carry the tab label");
assert.doesNotMatch(
  client,
  /dsh-plugin-card/u,
  "this plugin contributes a tab, not a plugin card; the card shell must not be bundled",
);
assert.doesNotMatch(
  client,
  /@yadsh\/dsh-plugin-log/u,
  "the server-only logger must never reach the browser bundle",
);
assert.doesNotMatch(
  client,
  /from\s+["']node:/u,
  "the browser bundle must not import node builtins",
);

// The host entry must not pull in the browser half.
const host = await readFile(new URL("../lib/index.js", import.meta.url), "utf8");
assert.doesNotMatch(host, /\.\/client\//u, "the host entry must not import src/client");
assert.match(host, /domainExperts/u);

// Documentation contract: the README names every registered tool (operator
// allow-lists are built from that list) and documents the enforcement
// vocabulary; SPEC.md is the product contract.
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
for (const toolName of ["domain_expert", "domain_experts_list", "domain_memory"]) {
  assert.match(readme, new RegExp(toolName, "u"), `README must document ${toolName}`);
}
assert.match(readme, /## Enforcement model/u);
assert.match(readme, /enforced/u);
assert.match(readme, /advisory/u);

const spec = await readFile(new URL("../SPEC.md", import.meta.url), "utf8");
assert.match(spec, /## 1\. Product contract/u);
assert.match(spec, /## 4\. Scope: Included \/ Deferred/u);
assert.match(spec, /## 6\. Implementation status/u);

console.log("verify-package: all gates passed");
