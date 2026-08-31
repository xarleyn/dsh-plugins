import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";
import PluginLogUi, { name, resolveConfig } from "../lib/index.js";

const root = new URL("../", import.meta.url);
const required = [
  "lib/index.js",
  "lib/client.js",
  "lib/types/index.d.ts",
  "lib/typert.host.js",
  "lib/typert.host.d.ts",
  "lib/typert.remote-client.js",
  "lib/typert.remote-client.d.ts",
  "cordis.patch.yml",
];

await Promise.all(required.map(async (path) => {
  const details = await stat(new URL(path, root));
  assert(details.isFile(), `${path} must be a file`);
}));

assert.equal(name, "plugin-log-ui");
assert.equal(PluginLogUi.name, "PluginLogUi");
assert.equal(resolveConfig().format, "text");

const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
assert.equal(manifest.name, "@yadsh/dsh-plugin-log-ui");
assert.equal(manifest.exports["./client"].default, "./lib/client.js");
assert.equal(manifest.exports["./remote"].default, "./lib/typert.remote-client.js");
assert.equal(manifest.dsh.client.platform, "web");

const patch = await readFile(new URL("cordis.patch.yml", root), "utf8");
assert.match(patch, /id:\s*dsh-plugin-log-ui/u);
assert.match(patch, /name:\s*"@yadsh\/dsh-plugin-log-ui"/u);

const client = await readFile(new URL("lib/client.js", root), "utf8");
assert.match(client, /__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-plugin-log-ui"/u);
assert.match(client, /settings\.plugin\.item/u);
assert.match(client, /key:\s*SETTINGS_NAMESPACE/u);
assert.match(client, /pluginLogUi/u);
assert.match(client, /remote\.pluginLogUi/u);
assert.doesNotMatch(client, /useSyncExternalStore\)\(scope\.subscribe/u);
assert.match(client, /dsh-plugin-card__name/u);
assert.match(client, /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u);
verifyPluginCardContract(client, {
  legacyPatterns: [/\.plu-card\{/u],
});
assert.doesNotMatch(client, /⌄/u);

console.log("verify-package: all gates passed");
