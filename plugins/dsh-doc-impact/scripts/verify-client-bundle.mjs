// Static guard over the shipped browser bundle (lib/client.js). These are the
// structural mistakes a refactor could make silently, so CI checks them
// without a browser:
//   - the ModuleLoader id must stay "@yadsh/dsh-doc-impact" (the served bundle URL
//     and the plugin inventory both key on the package name);
//   - the card must claim the `plugins.row.config` seat under the full key
//     `<package name>#<row id>`, both halves read from this bundle's own
//     `cordis.patch.yml` through one parser (`patch-row.mjs`) that
//     `tests/client-bundle.test.ts` shares — the page hands a row its configure
//     control only for a pair its roster carries, so the join is what has to appear,
//     not the two halves somewhere in the file. That the row id is also the settings
//     namespace the form reads through `ctx.configForms` is a runtime pairing and
//     belongs to the test; what is checked here are the values, never the names of
//     the constants that spell them, so a rename cannot redden this gate on its own;
//   - the entry must answer both views the page asks this seat for: the row's
//     one-liner (`view: 'summary'`, taken because this patch declares no description
//     of its own) and the configuration page (`view: 'page', form`);
//   - the seat it left behind must stay left behind: no `settings.plugins.tab`
//     registration, which would put a second copy of this card under Settings;
//   - the card is a body, not a card: the row page draws the frame, the heading and
//     the expand control, so a bundle that grew a shell of its own again would nest a
//     second frame inside the Host's. That is the shared contract's rule, and it reads
//     the seat off this bundle to decide it (`verify-plugin-card-contract.mjs` holds a
//     card seated on the row to no shell class, no chevron, and the Host's focus ring);
//     this file only adds the retired class names this package owns;
//   - the bundle must stay pure browser code: react only, no host packages;
//   - no secrets or telemetry may creep into the settings form.
import { readFile } from "node:fs/promises";
import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";
import { readPatchRow } from "./patch-row.mjs";

const client = await readFile(
  new URL("../lib/client.js", import.meta.url),
  "utf8",
);
// The row this bundle's seat key is built from. One parse of the patch, shared
// with tests/client-bundle.test.ts, so the two gates cannot drift onto different
// readings of the same declaration.
const { id: patchId, name: patchName } = await readPatchRow(
  new URL("../cordis.patch.yml", import.meta.url),
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
  `"${patchName}#${patchId}"`,
  "the keyed seat must be the join of the package name and the row id cordis.patch.yml " +
    "declares: the page hands a row its configure control only for a pair its roster " +
    "carries, so a bundle spelling one half and reaching for the other elsewhere is a " +
    "card that silently never appears. Matching the bare row id would not say — any " +
    "literal naming the namespace would pass it.",
);
expectPresent(
  "configForms.get(",
  "the form must be read through the host's settings form service",
);
expectPresent(
  'view === "summary"',
  "the page asks this seat for the row's one-liner when the patch declares no description, and this patch declares none",
);
expectAbsent(
  '"settings.plugins.tab"',
  "the card must not keep a tab of the old Settings surface beside its row",
);
// Whether the seat is claimed from inside `configForms.whileServed` is left to
// tests/client-bundle.test.ts, which proves it by never serving the namespace and
// expecting the card anyway. That is the honest place for it: the decision is about
// which call the entry makes, and a string needle only tracks how the bundle spells
// whichever call it makes — green on a rewrap that renames nothing only if the
// comment explaining the choice is compiled out, which is a build setting.
expectPresent(
  "resetField",
  "every field needs the composition-layer reset action",
);
expectPresent(
  '"unsaved"',
  "the write controls must carry the unsaved-drafts marker the row's header no longer offers",
);
expectPresent(
  "--dsw-focus-ring-width",
  "the ring of a control inside the Host's chrome comes from the Host's focus tokens, not a hard-coded outline the Host would suppress under pointer modality",
);
// The shell and the chevron are the shared contract's to reject, and it does: reading
// the seat off this bundle, a `dsh-plugin-card` class used as one or our chevron path
// fails as the second frame. This package adds no bare-word ban of its own, because the
// contract deliberately lets a comment name the class it stopped drawing — a stricter
// local rule would make the next agent delete a correct sentence to get green. What is
// local knowledge, and so checked below, is this bundle's own retired class names.
verifyPluginCardContract(client, {
  legacyPatterns: [/ddi_card/u],
});
expectAbsent(
  "ddi_card",
  "the bundle must not keep the pre-contract outer shell class",
);
expectAbsent(
  "ddi_list",
  "the body mounts directly, so the plugin-owned list element the shell needed is gone with it",
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
