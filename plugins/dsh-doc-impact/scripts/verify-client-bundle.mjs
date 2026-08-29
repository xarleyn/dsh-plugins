// Static guard over the shipped browser bundle (lib/client.js). These are the
// structural mistakes a refactor could make silently, so CI checks them
// without a browser:
//   - the ModuleLoader id must stay "dsh-doc-impact" (the served bundle URL
//     and the plugin inventory both key on the package name);
//   - the card must claim the settings.plugin.item slot under the doc-impact
//     settings namespace (that pairing is what the Plugin Configuration tab
//     dispatches on);
//   - the bundle must stay pure browser code: react only, no host packages;
//   - no secrets or telemetry may creep into the settings form.
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

function expectAbsent(needle, why) {
  if (client.includes(needle)) {
    throw new Error(`client bundle must not contain ${JSON.stringify(needle)} (${why})`);
  }
}

function expectPresent(needle, why) {
  if (!client.includes(needle)) {
    throw new Error(`client bundle is missing ${JSON.stringify(needle)} (${why})`);
  }
}

expectPresent('id: "dsh-doc-impact"', "the ModuleLoader factory id keys the served bundle");
expectPresent('"settings.plugin.item"', "the card must register into the shared Plugin Configuration slot");
expectPresent('key: SETTINGS_NS', "the card must claim the doc-impact settings namespace");
expectPresent('namespace: SETTINGS_NS', "the form must bind the doc-impact settings scope");
expectPresent('resetField', "every field needs the composition-layer reset action");
expectPresent('"unsaved"', "the header must carry the unsaved-changes badge");

// The bundle runs in the browser and may only require what the ModuleLoader
// page provides; anything @deepseek-ai would drag host internals into it.
expectAbsent('require("@deepseek-ai', "client code must not require host packages");
expectAbsent("require('@deepseek-ai", "client code must not require host packages");

// Settings content must stay local: no network calls, no storage beyond the
// settings scope contract.
expectAbsent("fetch(", "the settings card must not perform network requests");
expectAbsent("localStorage", "settings live in the host settings document, not local storage");
