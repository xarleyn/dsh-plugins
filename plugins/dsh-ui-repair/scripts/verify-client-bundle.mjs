import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyPluginCardContract } from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);

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
  "R010",
  "R011",
  "R012",
  "R013",
]) {
  assert.match(client, new RegExp(`\\b${ruleId}\\b`, "u"));
}
assert.match(client, /data-dsh-ui-repair-scroll-x/u);
assert.match(client, /data-dsh-ui-repair-text-wrap/u);
assert.match(client, /data-dsh-ui-repair-contain/u);
assert.match(client, /Applying\.\.\./u);
assert.match(client, /ResizeObserver/u);
assert.match(client, /"plugins\.row\.config"/u);
// The seat key is `<package name>#<row id>`, joined from the namespace the card
// reads its ConfigForm through, so the row half cannot drift away from it. The
// namespace itself is untouched by the move, which is what keeps a value saved
// before the upgrade readable after it; `verify-package.mjs` pins both halves
// against `package.json` and `cordis.patch.yml`.
assert.match(client, /key:\s*UI_REPAIR_ROW_CONFIG_KEY/u);
assert.ok(
  client.includes(
    "const UI_REPAIR_ROW_CONFIG_KEY = `@yadsh/dsh-ui-repair#${UI_REPAIR_SETTINGS_NAMESPACE}`",
  ),
  "the row-config key must join the package name to the settings namespace",
);
assert.match(client, /UI_REPAIR_SETTINGS_NAMESPACE\s*=\s*"dsh-ui-repair"/u);
// The page seats this entry twice, and the list the shell's `<li>` needs is the
// entry's own, not the page's.
assert.match(client, /className:\s*"uir-list"/u);
assert.match(client, /dsh-plugin-card__name/u);
assert.match(client, /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u);
verifyPluginCardContract(client, { legacyPatterns: [/uir-card/u] });
assert.doesNotMatch(client, /[⌄▾]/u);
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u);
assert.doesNotMatch(client, /localStorage/u);
assert.doesNotMatch(client, /fetch\(/u);

process.stdout.write(
  "verify-client-bundle: module identity and safety guards passed\n",
);
