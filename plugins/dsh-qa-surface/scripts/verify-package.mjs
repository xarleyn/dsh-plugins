import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import QaSurface, { name, resolveConfig } from "../lib/index.js";

const root = new URL("../", import.meta.url);
const required = [
  "lib/index.js",
  "lib/host-route.js",
  "lib/navigation-marker.js",
  "lib/client.js",
  "lib/client.js.map",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "cordis.patch.yml",
  "compatibility.json",
  "README.md",
  "LICENSE",
];

await Promise.all(
  required.map(async (path) => {
    const details = await stat(new URL(path, root));
    assert(details.isFile(), `${path} must be a file`);
  }),
);

assert.equal(name, "qa-surface");
assert.equal(QaSurface.name, "QaSurface");
assert.equal(resolveConfig().route.path, "/qa");

const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
assert.equal(manifest.name, "@yadsh/dsh-qa-surface");
assert.equal(manifest.exports["./client"].default, "./lib/client.js");
assert.equal(manifest.dsh.client.platform, "web");
assert(
  manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-layout"),
);
assert(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-runtime"));
assert.equal(
  `/plugins/${manifest.name}/client.js`,
  "/plugins/@yadsh/dsh-qa-surface/client.js",
  "scoped client bundle URL must preserve the full package name",
);

const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");
assert.match(patch, /id:\s*dsh-qa-surface/u);
assert.match(patch, /name:\s*"@yadsh\/dsh-qa-surface"/u);

const host = await readFile(new URL("lib/index.js", root), "utf8");
const hostRoute = await readFile(new URL("lib/host-route.js", root), "utf8");
const navigationMarker = await readFile(
  new URL("lib/navigation-marker.js", root),
  "utf8",
);
assert.match(host, /webServer/u);
assert.match(`${hostRoute}\n${navigationMarker}`, /__dsh_qa_route/u);
assert.doesNotMatch(`${host}\n${hostRoute}`, /registerFallback/u);

const client = await readFile(new URL("lib/client.js", root), "utf8");
assert.match(
  client,
  /__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-qa-surface"/u,
);
assert.match(client, /shell\.overlay/u);
assert.match(client, /id:\s*"dsh-qa-surface"/u);
assert.match(client, /\.prompt\(/u);
assert.match(client, /\.cancel\(/u);
assert.match(client, /\.create\(/u);
assert.match(client, /dsh-qa-surface:v1|:v1:/u);
assert.match(client, /data-dsh-qa-surface|dshQaSurface/u);
assert.match(client, /position:fixed;inset:0/u);
assert.doesNotMatch(client, /@deepseek-ai\/schemastery/u);
assert.doesNotMatch(client, /dangerouslySetInnerHTML/u);
assert.doesNotMatch(client, /chat\/completions|api\.openai\.com/u);
assert.doesNotMatch(client, /toolResult\.content/u);

console.log("verify-package: all gates passed");
