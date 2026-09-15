import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const patch = await readFile(
  new URL("../cordis.patch.yml", import.meta.url),
  "utf8",
);

assert.equal(manifest.name, "@yadsh/dsh-qa-browser");
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
assert.equal(manifest.scripts?.postinstall, undefined);
assert.equal(manifest.dependencies?.playwright, "catalog:tooling");
assert.match(patch, /id: dsh-qa-browser\b/u);
assert.match(patch, /name: "@yadsh\/dsh-qa-browser"/u);

for (const path of [
  "../lib/index.js",
  "../lib/index.d.ts",
  "../lib/client.js",
  "../lib/client/index.d.ts",
  "../lib/remote.js",
  "../lib/remote.d.ts",
  "../lib/types.js",
  "../lib/types.d.ts",
  "../README.md",
  "../docs/DOCKER.md",
  "../LICENSE",
]) {
  await access(new URL(path, import.meta.url));
}

const built = await import("../lib/index.js");
assert.equal(built.name, "dsh-qa-browser");
assert.equal(built.default, built.QaBrowserService);
assert.equal(built.QA_BROWSER_DEFAULTS.runtime.provider, "playwright");
assert.deepEqual(built.BROWSER_CORE_TOOL_NAMES, [
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select",
  "browser_press",
  "browser_hover",
  "browser_scroll",
  "browser_wait",
  "browser_tabs",
  "browser_viewport",
  "browser_history",
]);
assert.deepEqual(built.BROWSER_VISION_TOOL_NAMES, ["browser_screenshot"]);

assert.deepEqual(manifest.dsh?.client?.inject, [
  "@deepseek-ai/dsh-api-gateway",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-client-ui-slots",
  "@yadsh/dsh-qa-surface",
]);
const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
assert.match(
  client,
  /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-qa-browser"/u,
);
assert.match(client, /qa\.surface\.panel/u);
assert.match(client, /dsh-qa-browser-panel__viewport/u);
assert.match(client, /api-session\/status/u);
assert.doesNotMatch(client, /<iframe|createElement\("iframe"\)/iu);

console.log("verify-package: all gates passed");
