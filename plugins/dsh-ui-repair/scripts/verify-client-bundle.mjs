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
// The seat also asks this entry for `view: "summary"`, and the page prints that
// answer into its own description paragraph, so the arm returns the row's sentence
// and reads no store — mounting the body there would draw a page inside a line.
assert.match(client, /if \(props\.view === "summary"\) return ROW_SUMMARY;/u);
/*
 * The row's page is the card: it draws the surface, the heading and the expand
 * control before mounting this bundle's body (`div[data-plugin-config]`,
 * `lib/client.js:1851-1852` of the installed panel bundle). So a frame of ours in
 * this bundle is a second card, not a style choice, and these lines name the half
 * `verifyPluginCardContract` below derives from the seat. Reverting the shell here
 * fails with the reason attached rather than as an unreadable contract message.
 */
assert.doesNotMatch(
  client,
  /dsh-plugin-card(?:__[\w-]+|--open)/u,
  "the Plugins panel draws this card's frame, so the bundle carries no shell element class",
);
assert.doesNotMatch(
  client,
  /\.dsh-plugin-card(?=\s*[,{])/u,
  "the Plugins panel draws this card's frame, so the bundle carries no shell CSS rule",
);
assert.doesNotMatch(
  client,
  /uir-list/u,
  "the configuration section supplies no list for a shell <li> any more, so the body mounts directly",
);
assert.doesNotMatch(
  client,
  /m3\.5 5\.25 3\.5 3\.5 3\.5-3\.5/u,
  "the panel draws the disclosure control, so the bundle carries no chevron path",
);
/*
 * The one surviving citation of the shell class is the scanner's own repair root
 * (`src/client/dom.ts`): plugin cards that still own a frame — the settings
 * surfaces this series is migrating away from — are surfaces the repair scans, and
 * that selector is how they are found. It names somebody else's markup, and the
 * card contract reads the seat off the registration above rather than off any
 * mention, so it is pinned here rather than grepped away.
 */
assert.match(
  client,
  /"li\.dsh-plugin-card"/u,
  "the scanner still walks other plugins' own-shell cards as repair roots",
);
/*
 * Every control this body draws dresses its focus ring from the Host's token pair,
 * and both halves carry a fallback: a hard-coded outline loses to the Host's
 * `focus.css` under pointer modality, and an undeclared `--dsw-focus-ring-width`
 * invalidates the whole `outline` shorthand instead of degrading it.
 */
assert.match(
  client,
  /outline:var\(--dsw-focus-ring-width, 2px\) solid var\(--dsw-focus-ring-color, var\(--dsw-alias-state-business-primary\)\)/u,
  "the card's controls take the Host's focus ring with fallbacks on both halves",
);
for (const control of ["uir-control", "uir-toggle", "uir-button"]) {
  assert.ok(
    client.includes(`.${control}:focus-visible{`),
    `${control} renders no focus ring of its own`,
  );
}
verifyPluginCardContract(client, { legacyPatterns: [/uir-card/u] });
assert.doesNotMatch(client, /[⌄▾]/u);
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//u);
assert.doesNotMatch(client, /localStorage/u);
assert.doesNotMatch(client, /fetch\(/u);

process.stdout.write(
  "verify-client-bundle: module identity and safety guards passed\n",
);
