import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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

// Host entry: the pipeline installs itself and the five tools come from it.
const entry = await readFile(new URL("lib/index.js", root), "utf8");
assert.match(entry, /installDocumentSubsystem/u);
assert.match(entry, /DOCUMENT_TOOL_NAMES/u);

console.log("built package contract passed");
