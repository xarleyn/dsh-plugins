import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import SleevIntegrationService, { name, resolveConfig } from "../lib/index.js";
import {
  DEFAULT_SLEEV_GATEWAY_URL,
  EXPERIMENTAL_DSH_HARNESS_ID,
  buildSleevHeaders,
} from "../lib/host/optimizer/sleev/headers.js";

const packageRoot = new URL("../", import.meta.url);
const requiredFiles = [
  "lib/index.js",
  "lib/client.js",
  "lib/shared/telemetry.js",
  "lib/host/optimizer/sleev/headers.js",
  "lib/types/index.d.ts",
  "lib/types/client/index.d.ts",
  "cordis.patch.yml",
];

await Promise.all(
  requiredFiles.map(async (path) => {
    const details = await stat(new URL(path, packageRoot));
    assert(details.isFile(), `${path} must be a file`);
  }),
);

assert.equal(name, "dsh-sleev");
assert.equal(SleevIntegrationService.name, "SleevIntegrationService");
assert.equal(DEFAULT_SLEEV_GATEWAY_URL, "http://127.0.0.1:17321/v1");
assert.equal(EXPERIMENTAL_DSH_HARNESS_ID, "pi");
assert.deepEqual(resolveConfig().routePrefixes, ["sleev-"]);
assert.deepEqual(
  buildSleevHeaders({
    kind: "custom",
    baseUrl: "https://api.example.test/v1",
    harnessId: "pi",
  }),
  {
    "sleev-base-url": "https://api.example.test/v1",
    "sleev-harness": "pi",
  },
);

const patch = await readFile(new URL("cordis.patch.yml", packageRoot), "utf8");
assert.match(patch, /id:\s*sleev/u);
assert.match(patch, /name:\s*dsh-sleev/u);

const manifest = JSON.parse(
  await readFile(new URL("package.json", packageRoot), "utf8"),
);
assert.equal(manifest.exports["./client"].default, "./lib/client.js");
assert.equal(manifest.dsh.client.platform, "web");
assert(
  manifest.dsh.client.inject.includes(
    "@deepseek-ai/dsh-client-ui-settings-plugins",
  ),
);

const client = await readFile(new URL("lib/client.js", packageRoot), "utf8");
assert.match(client, /__ModuleLoader__\.load\(\{\s*id:\s*"dsh-sleev"/u);
assert.match(client, /settings\.plugin\.item/u);
assert.match(client, /key: SETTINGS_NAMESPACE/u);

console.log("built package contract passed");
