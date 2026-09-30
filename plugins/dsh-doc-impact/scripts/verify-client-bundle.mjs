// Static guard over the shipped browser bundle (lib/client.js). These are the
// structural mistakes a refactor could make silently, so CI checks them
// without a browser:
//   - the ModuleLoader id must stay "@yadsh/dsh-doc-impact" (the served bundle URL
//     and the plugin inventory both key on the package name);
//   - the card must claim the `plugins.row.config` seat keyed to this bundle's
//     row, and that key must join the package name to the profile entry id, which
//     on this host is also the settings namespace it reads through `ctx.configForms`
//     (that pairing is what keeps a value saved before the move readable after it);
//   - the bundle must stay pure browser code: react only, no host packages;
//   - no secrets or telemetry may creep into the settings form.
import { readFile } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);

function expectAbsent(needle, why) {
  if (client.includes(needle)) {
    throw new Error(
      `client bundle must not contain ${JSON.stringify(needle)} (${why})`,
    );
  }
}

function expectPresent(needle, why) {
  if (!client.includes(needle)) {
    throw new Error(
      `client bundle is missing ${JSON.stringify(needle)} (${why})`,
    );
  }
}

expectPresent(
  "window.__ModuleLoader__.load({",
  "the bundle registers through the shared ModuleLoader",
);
expectPresent(
  'id: "@yadsh/dsh-doc-impact"',
  "the ModuleLoader factory id keys the served bundle",
);
expectPresent(
  '"plugins.row.config"',
  "the card must register as the configuration entry of its own row on the Plugins page",
);
expectPresent(
  "@yadsh/dsh-doc-impact#",
  "the keyed seat must start from this bundle's package name",
);
expectPresent(
  "${SETTINGS_NS}",
  "the keyed seat must end at the settings namespace, which is the row id the patch declares",
);
expectPresent(
  "key: ROW_CONFIG_KEY",
  "the seat must be keyed by that package-and-namespace pair, not by a tab id of its own",
);
expectPresent(
  "configForms.get(SETTINGS_NS)",
  "the form must read the doc-impact settings namespace through the host form",
);
expectPresent(
  'view === "summary"',
  "the same entry is rendered as the row's one-liner, and that view must not mount the form",
);
expectPresent(
  "resetField",
  "every field needs the composition-layer reset action",
);
expectPresent('"unsaved"', "the header must carry the unsaved-changes badge");
expectPresent(
  "dsh-plugin-card__name",
  "custom cards must share the standard card shell",
);
expectPresent(
  "m3.5 5.25 3.5 3.5 3.5-3.5",
  "the header must use the standard SVG chevron",
);
verifyPluginCardContract(client, {
  legacyPatterns: [/ddi_card/u],
});
expectAbsent(
  "ddi_card",
  "the outer card shell must use the shared class contract",
);
expectAbsent(
  "▾",
  "font-dependent disclosure glyphs must not replace the SVG chevron",
);

// The bundle runs in the browser and may only require what the ModuleLoader
// page provides; anything @deepseek-ai would drag host internals into it.
expectAbsent(
  'require("@deepseek-ai',
  "client code must not require host packages",
);
expectAbsent(
  "require('@deepseek-ai",
  "client code must not require host packages",
);

// Settings content must stay local: no network calls, no storage beyond the
// settings form contract.
expectAbsent("fetch(", "the settings card must not perform network requests");
expectAbsent(
  "localStorage",
  "settings live in the host settings document, not local storage",
);
