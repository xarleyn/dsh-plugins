import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);

assert.equal(manifest.name, "@yadsh/dsh-documents");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.dsh?.client?.platform, "web");

for (const path of [
  "lib/index.js",
  "lib/client.js",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "cordis.patch.yml",
]) {
  assert((await stat(new URL(path, root))).isFile(), `${path} must be built`);
}

// A subpath that no build step produces is a promise the package cannot keep:
// the packed-tarball gate catches it only in a packing run, so pin it here.
for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
  if (subpath === "./package.json") continue;
  for (const key of ["types", "default"]) {
    const path = target?.[key];
    if (path === undefined) continue;
    assert(
      (await stat(new URL(path, root))).isFile(),
      `exports["${subpath}"].${key} must be built: ${path}`,
    );
  }
}

const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");
assert.match(patch, /id:\s*documents/u);
assert.match(patch, /name:\s*"@yadsh\/dsh-documents"/u);

const client = await readFile(new URL("lib/client.js", root), "utf8");
// Browser bundle identity: the ModuleLoader registration id is the FULL package name.
assert.match(
  client,
  /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-documents"/u,
);
// A card registers into the shared slot through the declared client services.
const clientInject = /const inject = \[([^\]]*)\]/u.exec(client);
assert.notEqual(clientInject, null, "client bundle must export an inject list");
assert.match(
  clientInject[1],
  /"settingsScope"/u,
  "the client must declare the settingsScope service",
);
// The browser has no module table for Node builtins: one `require("node:…")`
// left in the bundle is a card that never mounts.
for (const builtin of [
  "node:path",
  "node:fs",
  "node:fs/promises",
  "node:zlib",
  "node:os",
  "node:child_process",
]) {
  assert.equal(
    client.includes(`require("${builtin}")`),
    false,
    `client bundle must not require ${builtin}`,
  );
}

verifyPluginCardContract(client, {
  legacyPatterns: [/\.dsh-docs-card\{/u, /\.dsh-plugin-card \*/u],
});

// Host entry: the pipeline installs itself, the five semantic tools and the
// comparison pair come from it, and the skill ships with it.
const entry = await readFile(new URL("lib/index.js", root), "utf8");
assert.match(entry, /installDocumentSubsystem/u);
assert.match(entry, /DOCUMENT_TOOL_NAMES/u);
assert.match(entry, /mountDocumentSkills/u);
// The in-process face sibling host plugins convert through (no Remote: the
// name is published with ctx.provide and looked up by string).
assert.match(entry, /provide\("documents"/u);
assert.match(entry, /toMarkdown/u);
assert.match(entry, /convert/u);
// The package builds per module, so the comparison tools live beside the
// others and each one declares its own name.
const compareTool = await readFile(
  new URL("lib/documents/tools/compare.js", root),
  "utf8",
);
assert.match(compareTool, /document_compare/u);
const diffReadTool = await readFile(
  new URL("lib/documents/tools/diff-read.js", root),
  "utf8",
);
assert.match(diffReadTool, /document_diff_read/u);

const skill = await readFile(
  new URL("skills/contract-review/SKILL.md", root),
  "utf8",
);
assert.match(skill, /^---\r?\nname: contract-review$/mu);
assert.match(
  skill,
  /^allowed-tools: document_inspect document_compare document_diff_read$/mu,
);
assert(
  manifest.files.includes("skills"),
  'package.json files must ship "skills"',
);

// The comparison runs in-process. A module under `comparison/` that could
// reach a process or a socket would break the one promise the feature is built
// on, so the imports are checked at the source rather than trusted.
const comparisonFiles = await sourceFiles(
  new URL("src/documents/comparison/", root),
);
assert(comparisonFiles.length > 10, "the comparison sources must be present");
for (const file of comparisonFiles) {
  const text = await readFile(file, "utf8");
  for (const forbidden of [
    "child_process",
    "spawnSync",
    "execFile",
    "node:net",
    "node:http",
    "node:https",
    "node:worker_threads",
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `${file.pathname} must not reach ${forbidden}`,
    );
  }
}

async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory()) found.push(...(await sourceFiles(child)));
    else if (entry.name.endsWith(".ts")) found.push(child);
  }
  return found;
}

console.log("built package contract passed");
