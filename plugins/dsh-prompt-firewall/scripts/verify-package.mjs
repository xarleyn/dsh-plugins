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
  client: { platform: "web" },
  clientBundle: {
    matches: [/id:\s*"@yadsh\/dsh-prompt-firewall"/u],
    notMatches: [/useSyncExternalStore\)\(scope\.subscribe/u],
    cardContract: {
      legacyPatterns: [
        /\.pf-card\{/u,
        /pf-card-status--off/u,
        /\.dsh-plugin-card \*/u,
      ],
    },
  },
});
