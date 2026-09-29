/**
 * Package gate for @yadsh/dsh-ui-repair.
 *
 * Validates the manifest and the built exports. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the card shell itself is
 * asserted by scripts/verify-client-bundle.mjs through
 * verify-plugin-card-contract.
 */
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
});
