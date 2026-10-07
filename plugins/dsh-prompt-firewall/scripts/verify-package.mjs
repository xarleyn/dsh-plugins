/**
 * Package gate for @yadsh/dsh-prompt-firewall.
 *
 * The shared manifest/patch/client checks and the canonical card shell
 * contract (verify-plugin-card-contract) come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-prompt-firewall",
  requiredFiles: [
    "lib/index.js",
    "lib/client.js",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
    "lib/types/index.d.ts",
    "lib/types/client/index.d.ts",
    "cordis.patch.yml",
  ],
  patch: { id: "dsh-prompt-firewall" },
  client: {
    platform: "web",
    // The card is the configuration seat of this bundle's row on the Plugins
    // page, so that page's package is an activation dependency of the client half
    // and must be requested from the host.
    injectIncludes: ["@deepseek-ai/dsh-client-ui-plugin-manager"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: [
      "plugins.row.config",
      // The keyed seat this card occupies: `<package name>#<row id>`.
      "@yadsh/dsh-prompt-firewall#",
    ],
    matches: [/const inject = \[[^\]]*"configForms"[^\]]*\]/u],
    notMatches: [
      /require\("node:(?:path|fs|fs\/promises|zlib|os|child_process)"\)/u,
      // The tab of the Plugins settings section is the surface this card left;
      // a second render site would show it twice.
      /"settings\.plugins\.tab"/u,
    ],
    cardContract: {
      // The seat is the Plugins panel row, so the shared card-contract gate holds
      // this bundle to the host-chrome half: no `dsh-plugin-card*` class, no
      // chevron of ours, the ring built from the Host's focus tokens. What is left
      // here is the shell and the list root this bundle drew for the tab.
      legacyPatterns: [
        /\.pf-card\{/u,
        /pf-card-status--off/u,
        /\.dsh-plugin-card \*/u,
        /\.pf-settings\{/u,
      ],
    },
  },
});
