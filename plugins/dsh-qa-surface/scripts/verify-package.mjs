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
  "lib/typert.host.js",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "cordis.patch.yml",
  "compatibility.json",
  "capability-policy.json",
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
assert.equal(
  manifest.exports["./remote"].default,
  "./lib/typert.remote-client.js",
);
assert.equal(manifest.exports["./typert"].default, "./lib/typert.host.js");
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
const remote = await readFile(
  new URL("lib/typert.remote-client.js", root),
  "utf8",
);
const hostRoute = await readFile(new URL("lib/host-route.js", root), "utf8");
const navigationMarker = await readFile(
  new URL("lib/navigation-marker.js", root),
  "utf8",
);
assert.match(host, /webServer/u);
assert.match(`${hostRoute}\n${navigationMarker}`, /__dsh_qa_route/u);
assert.doesNotMatch(`${host}\n${hostRoute}`, /registerFallback/u);
assert.match(host, /permissionPresets\.set/u);
assert.match(host, /agentPresets\.composedPreset/u);
assert.match(host, /\.tools\.restrict/u);
assert.match(host, /\.tools\.guard/u);
assert.match(host, /qaToolPolicyPlan/u);
assert.match(host, /allow:\s*policy\.allow/u);
assert.doesNotMatch(host, /\.tools\.presentAs\("native"\)/u);
assert.match(host, /existing non-QA session cannot be adopted/u);
assert.match(remote, /qaSurface\/secureSession/u);
assert.match(remote, /qaSurface\/describe/u);

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
assert.match(client, /secureSession/u);
assert.match(client, /Assistant configuration is unavailable\./u);
assert.match(client, /dsh-qa-surface:v1|:v1:/u);
assert.match(client, /dsh-qa-sidebar/u);
assert.match(client, /Chat history/u);
assert.match(client, /policy attestation failed \(reason:/u);
assert.match(client, /data-dsh-qa-surface|dshQaSurface/u);
assert.match(client, /position:fixed;inset:0/u);
assert.match(client, /--dsw-specific-bubble/u);
assert.match(client, /--dsw-specific-input-major/u);
assert.match(client, /Copy message/u);
assert.match(client, /Enter to send/u);
assert.doesNotMatch(client, /@deepseek-ai\/schemastery/u);
assert.doesNotMatch(client, /dangerouslySetInnerHTML/u);
assert.doesNotMatch(client, /chat\/completions|api\.openai\.com/u);
assert.doesNotMatch(client, /toolResult\.content/u);
assert.doesNotMatch(client, /\.command\(/u);
assert.doesNotMatch(client, /\.rename\(/u);
assert.doesNotMatch(client, /sessions\.delete|deleteSession/u);

const capabilityPolicy = JSON.parse(
  await readFile(new URL("capability-policy.json", root), "utf8"),
);
assert.equal(capabilityPolicy.version, 1);
assert.deepEqual(
  capabilityPolicy.tools.map((entry) => entry.name),
  resolveConfig().lockdown.toolPolicy.allow,
  "every default allow-listed tool must have a reviewed capability entry",
);

console.log("verify-package: all gates passed");
