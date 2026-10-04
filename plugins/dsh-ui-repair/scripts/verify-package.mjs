/**
 * Package gate for @yadsh/dsh-ui-repair.
 *
 * Validates the manifest and the built exports. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the card shell itself is
 * asserted by scripts/verify-client-bundle.mjs through
 * verify-plugin-card-contract.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-ui-repair",
  exports: [".", "./client", "./types", "./package.json"],
  client: {
    platform: "web",
    injectEquals: [
      "@deepseek-ai/dsh-client-ui-plugin-manager",
      "@deepseek-ai/dsh-client-ui-settings",
    ],
  },
  patch: { id: "dsh-ui-repair" },
  files: ["cordis.patch.yml", "compatibility.json", "README.md", "LICENSE"],
  requiredFiles: [
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
    "lib/index.js",
    "lib/client.js",
    "lib/types/index.d.ts",
  ],
  clientBundle: {
    /*
     * One test id of the epic #453 pass is pinned as the representative of the
     * rest, so an id no gate reads cannot be renamed away unnoticed. The
     * `data-dsh-ui-repair-*` hooks the card keeps itself out of its own scan
     * with are asserted by scripts/verify-client-bundle.mjs; these ids sit
     * beside them and are asserted on the attribute, not the bare value.
     */
    matches: [/["']data-testid["']\s*:\s*["']repair-mode["']/u],
  },
  extra: ({ client, manifest, patch }) => {
    /*
     * The Plugins page shows the row's configure control only for the
     * `<package name>#<row id>` key the entry registers under, and it derives the
     * settings namespace from the same row id. Renaming either half drops the card
     * off the panel or strands the stored values, and neither fails loudly — so
     * both are pinned to the manifest and to the patch here.
     */
    assert.ok(client !== undefined, "the built client bundle is missing");
    assert.ok(patch !== undefined, "cordis.patch.yml is missing");
    const rowId = /^\s*- id:\s*(\S+)\s*$/mu.exec(patch)?.[1];
    assert.ok(rowId !== undefined, "cordis.patch.yml declares no entry id");
    assert.ok(
      client.includes(`const UI_REPAIR_SETTINGS_NAMESPACE = "${rowId}"`),
      `the settings namespace must stay the row id the patch declares (${rowId})`,
    );
    assert.ok(
      client.includes(
        `const UI_REPAIR_ROW_CONFIG_KEY = \`${manifest.name}#\${UI_REPAIR_SETTINGS_NAMESPACE}\``,
      ),
      "the row-config key must be the published package name joined to the namespace",
    );
  },
});
