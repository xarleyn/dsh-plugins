// Package gate for @yadsh/dsh-plugin-kit. The package publishes no Cordis patch
// and no self-registering browser bundle, but every settings card of this repository
// is built from its `./client` surface, so the shell contract AGENTS.md states once is
// asserted here against the code each plugin's bundle inlines. A kit bundle names no
// seat of its own, so it is held to the canonical shell half directly rather than
// through the seat-aware dispatcher a plugin bundle goes through.
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import { verifyCanonicalShell } from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-plugin-kit",
  license: "MIT",
  bundlePatch: false,
  client: "none",
  exports: [".", "./client", "./sqlite"],
  exportDefaults: {
    ".": "./lib/index.js",
    "./client": "./lib/client/index.js",
    "./sqlite": "./lib/sqlite.js",
  },
  exportsBuilt: true,
  mainTypesMatchRootExport: true,
  publishedDependenciesResolve: true,
  files: ["lib", "README.md", "LICENSE"],
  requiredFiles: ["README.md", "LICENSE"],
  extra: async ({ readFile }) => {
    // The three modules that make one card: the sheet, the chevron and the
    // shell that renders them. Checked together because the contract reads a
    // stylesheet and a render for what a single file cannot carry.
    verifyCanonicalShell(
      [
        await readFile("lib/client/plugin-card-css.js"),
        await readFile("lib/client/chevron.js"),
        await readFile("lib/client/card-shell.js"),
      ].join("\n"),
    );

    const client = await import("../lib/client/index.js");
    // The `./client` names README lists as the published surface. Nothing in
    // this workspace would miss a dropped one — a plugin bundle imports the
    // shell and the sheet, not the registration helpers — so the breakage would
    // only ever reach a consumer that installs this package.
    for (const name of [
      "CardShell",
      "ChevronDown",
      "PLUGIN_CARD_SHELL_CSS",
      "injectCardStyles",
      "registerSettingsCard",
      "registerSettingsSlot",
    ]) {
      assert.ok(
        Object.hasOwn(client, name),
        `the client surface must keep the ${name} export`,
      );
    }
    assert.equal(
      client.SETTINGS_PLUGIN_ITEM_SLOT,
      "settings.plugin.item",
      "the slot registerSettingsCard mounts a card into by default",
    );
  },
});
