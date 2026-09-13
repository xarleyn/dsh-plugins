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
// The panel lives in the right Sidebar, so that package is an activation
// dependency of the client half and must be requested from the host.
assert.ok(
  manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-sidebar-right"),
  "dsh.client.inject must request the right Sidebar package",
);
assert.equal(
  manifest.peerDependencies["@deepseek-ai/dsh-client-ui-sidebar-right"],
  "catalog:dsh",
  "the right Sidebar package must be a peer dependency",
);

const compatibility = JSON.parse(await readFile(new URL("compatibility.json", root), "utf8"));
for (const feature of ["sidebar.right.pane.tab", "sidebarRightTabs"]) {
  assert.ok(
    compatibility.deepseekHarness.requiredClientFeatures.includes(feature),
    `compatibility.json must declare the ${feature} client feature`,
  );
}

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

/*
 * Right-Sidebar panel contract.
 *
 * A tab type is two registrations that must agree: the type in
 * `sidebarRightTabs` and the body in the keyed seat under the type's own `id`.
 * A bundle with one and not the other draws the column's "nothing can view
 * this" notice, which no host-side test can see, so the pair is asserted here.
 */
const PANEL_ID = "@yadsh/dsh-plugin-log-ui/panel";
assert.match(client, /sidebarRightTabs/u);
assert.ok(client.includes(`const LOG_PANEL_ID = "${PANEL_ID}"`), "the bundle must carry the panel's id");
assert.match(client, /id:\s*LOG_PANEL_ID/u);
assert.match(client, /const LOG_PANEL_KIND = "plugin-log"/u);
assert.match(client, /kind:\s*LOG_PANEL_KIND/u);
assert.match(client, /priority:\s*"extension"/u);
assert.match(client, /name:\s*"sidebar\.right\.pane\.tab"/u);
assert.match(client, /key:\s*LOG_PANEL_ID/u);
assert.match(client, /title:\s*\(\)\s*=>\s*"Plugin logs"/u);
assert.match(client, /order:\s*20/u);
// Nothing claims a resource address: the panel is a page, opened by kind.
assert.doesNotMatch(client, /patterns:\s*\[/u);
// The panel reads the stream through the Remote method that ships with it, and
// asks the registry for the sources its filter offers.
assert.match(client, /remote\.tail\(cursor, limit\)/u);
assert.match(client, /sources: async \(\) =>/u);
assert.match(client, /consumers\.map\(\(consumer\) => consumer\.pluginId\)/u);
// Severity ink: the quiet levels ride the label ramp, warn and above take the
// state tokens. Asserted so a stylesheet refactor cannot quietly drop the
// colouring the panel exists for, or sink the clock back into the faintest ink.
for (const token of [
  "--dsw-alias-label-dimmed",
  "--dsw-alias-label-tertiary",
  "--dsw-alias-label-secondary",
  "--dsw-alias-state-warn-label",
  "--dsw-alias-state-error-primary",
  "--dsw-alias-bg-error",
]) {
  assert.ok(client.includes(token), `panel styles must use ${token}`);
}
assert.ok(
  client.includes(".plu-log-time{color:var(--dsw-alias-label-secondary)"),
  "the clock must stay above the dimmed ink it started on",
);
for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
  assert.ok(client.includes(level), `the panel must offer the ${level} level`);
}
// The source filter: a select over the registered consumers, with the
// every-source option its value space is written against.
assert.ok(client.includes("plu-log-source"), "the panel must offer the source filter");
assert.ok(client.includes("All sources"), "the source filter needs its every-source option");
// Two sheets, two style keys. `injectCardStyles` is idempotent per key, so one
// key for both sheets leaves the second injected nowhere — the card rendered
// unstyled and nothing failed. The pair is asserted, and the runtime half (both
// tags really reaching the document) is a test in tests/client-panel.test.ts.
assert.ok(client.includes('const CARD_STYLE_KEY = "dsh-plugin-log-ui"'), "the card sheet key");
assert.ok(
  client.includes("const PANEL_STYLE_KEY = `${CARD_STYLE_KEY}/panel`"),
  "the panel sheet must have its own key",
);
assert.ok(client.includes(".plu-grid{"), "the card sheet must ship");
assert.ok(client.includes(".plu-log{"), "the panel sheet must ship");

console.log("verify-package: all gates passed");
