/**
 * Package gate for @yadsh/dsh-sleev.
 *
 * The shared manifest/patch/client checks and the canonical card shell
 * contract (verify-plugin-card-contract) come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the runtime identity checks
 * stay local.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import SleevIntegrationService, { name, resolveConfig } from "../lib/index.js";
import {
  DEFAULT_SLEEV_GATEWAY_URL,
  EXPERIMENTAL_DSH_HARNESS_ID,
  buildSleevHeaders,
} from "../lib/host/optimizer/sleev/headers.js";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-sleev",
  requiredFiles: [
    "lib/index.js",
    "lib/client.js",
    "lib/shared/telemetry.js",
    "lib/host/optimizer/sleev/headers.js",
    "lib/types/index.d.ts",
    "lib/types/client/index.d.ts",
    "cordis.patch.yml",
  ],
  patch: { id: "dsh-sleev" },
  exportDefaults: { "./client": "./lib/client.js" },
  client: {
    platform: "web",
    injectIncludes: ["@deepseek-ai/dsh-client-ui-settings-plugins"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: [
      "settings.plugin.item",
      "key: SETTINGS_NAMESPACE",
      "dsh-plugin-card__name",
      "m3.5 5.25 3.5 3.5 3.5-3.5",
    ],
    notMatches: [/dsw-alias-border-label-dimmed/u, /⌄/u],
    cardContract: { legacyPatterns: [/\.dsh-sleev-card\{/u] },
  },
  extra: () => {
    assert.equal(name, "dsh-sleev");
    assert.equal(SleevIntegrationService.name, "SleevIntegrationService");
    assert.equal(DEFAULT_SLEEV_GATEWAY_URL, "http://127.0.0.1:17321/v1");
    assert.equal(EXPERIMENTAL_DSH_HARNESS_ID, "pi");
    assert.deepEqual(resolveConfig().routePrefixes, ["sleev-"]);
    assert.deepEqual(
      buildSleevHeaders({
        kind: "custom",
        baseUrl: "https://api.example.test/v1",
        harnessId: "pi",
      }),
      {
        "sleev-base-url": "https://api.example.test/v1",
        "sleev-harness": "pi",
      },
    );
  },
});
