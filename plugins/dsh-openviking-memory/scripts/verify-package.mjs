// Package gates for @yadsh/dsh-openviking-memory. Run after `pnpm build`:
// the tarball has to carry the compiled host runtime, the canonical bundle
// patch, the vendored skill, the MCP proxy entrypoint, and the Apache-2.0
// attribution files required by the upstream licence.
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const patch = await readFile(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const upstream = await readFile(new URL("../UPSTREAM.md", import.meta.url), "utf8");
const compatibility = JSON.parse(
  await readFile(new URL("../compatibility.json", import.meta.url), "utf8"),
);

assert.equal(manifest.name, "@yadsh/dsh-openviking-memory");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.ok(Object.hasOwn(manifest.exports, "."));

// Canonical bundle ids: `id` is the unscoped runtime id (also the client bundle
// URL segment), `name` is the exact published package name in double quotes.
assert.match(patch, /id: dsh-openviking-memory\b/u);
assert.match(patch, new RegExp(`name: "${manifest.name}"`, "u"));

// Derived package: the upstream project is Apache-2.0 and this package must
// keep that licence rather than inherit the repository's MIT one.
assert.equal(manifest.license, "Apache-2.0");
assert.match(license, /Apache License/u);
assert.match(license, /Version 2\.0, January 2004/u);
assert.match(upstream, /https:\/\/github\.com\/volcengine\/OpenViking/u);
assert.match(upstream, /@openviking\/dsh-memory-plugin/u);
assert.match(upstream, /688f78e923d2269d96c27096fe2dad10156ebdb8/u);
assert.match(upstream, /not an official OpenViking distribution/u);

// The published tarball has to declare every artefact it references at runtime.
// UPSTREAM.md deliberately stays in the repository: the package-hygiene gate
// keeps documentation out of the tarball, and the published README carries the
// same attribution with an absolute link back to it.
for (const entry of ["lib", "skills", "cordis.patch.yml", "compatibility.json", "README.md", "LICENSE"]) {
  assert.ok(manifest.files.includes(entry), `package.json#files must publish ${entry}`);
}
assert.equal(compatibility.node, manifest.engines.node);
assert.deepEqual(compatibility.deepseekHarness.testedReleases, ["0.1.5-rc.2"]);

// DSH runtime packages are peers, never bundled dependencies.
assert.equal(manifest.dependencies["@deepseek-ai/cordis"], undefined);
for (const name of Object.keys(manifest.peerDependencies)) {
  if (!name.startsWith("@deepseek-ai/")) continue;
  assert.equal(manifest.devDependencies[name] !== undefined, true, `${name} needs a dev copy`);
  assert.equal(manifest.dependencies[name], undefined, `${name} must not be a dependency`);
}

for (const path of [
  "../lib/index.js",
  "../lib/index.d.ts",
  "../lib/client.js",
  "../lib/servers/mcp-proxy.js",
  "../lib/openviking/mcp-proxy-core.js",
  "../skills/openviking-memory/SKILL.md",
  "../README.md",
  "../LICENSE",
  "../UPSTREAM.md",
]) {
  await access(new URL(path, import.meta.url));
}

const proxy = await readFile(new URL("../lib/servers/mcp-proxy.js", import.meta.url), "utf8");
assert.match(proxy, /createOpenVikingMcpProxy/u);
assert.doesNotMatch(proxy, /^#!\/usr\/bin\/env/u, "proxy is spawned via process.execPath, not a shebang");

const skill = await readFile(
  new URL("../skills/openviking-memory/SKILL.md", import.meta.url),
  "utf8",
);
assert.match(skill, /^---\nname: openviking-memory\n/u);

console.log("verify-package: all gates passed");
