import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

assert.match(
  client,
  /window\.__ModuleLoader__\.load\(\{\s*id:\s*"@yadsh\/dsh-ui-repair"/u,
);
assert.match(client, /data-dsh-ui-repair-scope/u);
assert.match(client, /data-dsh-ui-repair-target/u);
assert.match(client, /MutationObserver/u);
for (const ruleId of [
  "R001",
  "R002",
  "R003",
  "R004",
  "R005",
  "R006",
  "R007",
  "R008",
  "R009",
]) {
  assert.match(client, new RegExp(`\\b${ruleId}\\b`, "u"));
}
assert.match(client, /data-dsh-ui-repair-scroll-x/u);
assert.match(client, /Applying\.\.\./u);
assert.match(client, /ResizeObserver/u);
assert.match(client, /"settings\.plugin\.item"/u);
assert.match(client, /key:\s*"ui-repair"/u);
assert.match(client, /dsh-plugin-card__name/u);
assert.match(client, /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u);
verifyPluginCardContract(client, { legacyPatterns: [/uir-card/u] });
assert.doesNotMatch(client, /[⌄▾]/u);
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u);
assert.doesNotMatch(client, /localStorage/u);
assert.doesNotMatch(client, /fetch\(/u);

process.stdout.write("verify-client-bundle: module identity and safety guards passed\n");
