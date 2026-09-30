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
  compatibility: { clientFeatures: ["plugins.row.config"] },
  exportDefaults: { "./client": "./lib/client.js" },
  client: {
    platform: "web",
    injectIncludes: ["@deepseek-ai/dsh-client-ui-plugin-manager"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: [
      "plugins.row.config",
      "@yadsh/dsh-sleev#",
      "dsh-plugin-card__name",
      "m3.5 5.25 3.5 3.5 3.5-3.5",
    ],
    // One test id of the epic #453 pass is pinned as the representative of the
    // rest: an id no gate reads can be renamed away without anything noticing.
    // The attribute is asserted, not the bare value — `dsh-sleev-save` is a
    // class name too, so the string alone would pass with the id gone.
    matches: [/["']data-testid["']\s*:\s*["']sleev-save["']/u],
    notMatches: [
      /dsw-alias-border-label-dimmed/u,
      /⌄/u,
      // The card left this section, so a registration returning to it is a
      // regression the bundle itself has to reject.
      /settings\.plugins\.tab/u,
    ],
    cardContract: { legacyPatterns: [/\.dsh-sleev-card\{/u] },
  },
  extra: async ({ patch, readFile }) => {
    assert.equal(name, "dsh-sleev");
    assert.equal(SleevIntegrationService.name, "SleevIntegrationService");
    assert.equal(DEFAULT_SLEEV_GATEWAY_URL, "http://127.0.0.1:17321/v1");
    assert.equal(EXPERIMENTAL_DSH_HARNESS_ID, "pi");
    // The seat key joins the package name to the row id, and since 0.1.7 the row
    // id is the settings namespace, so the two are one fact. The bundler folds
    // the join away, so no `includes` can read the shipped key as a literal, and
    // each half is gate-checked on its own elsewhere: rename either one and every
    // other gate still passes while the row's configure control stops appearing.
    // `dsh-model-safety-gate` pins the same pair against its patch.
    const rowId = /^\s*- id: (\S+)$/mu.exec(patch ?? "")?.[1];
    const seat = await readFile("src/shared/settings.ts");
    // Read on its own: two failed extractions would otherwise compare equal.
    assert.ok(rowId, "cordis.patch.yml must declare the row id");
    assert.equal(
      /SLEEV_SETTINGS_NAMESPACE_ID\s*=\s*"([^"]+)"/u.exec(seat)?.[1],
      rowId,
      `the settings namespace must be the profile entry id ${rowId} that cordis.patch.yml declares`,
    );
    assert.match(
      seat,
      /SLEEV_ROW_CONFIG_KEY = `@yadsh\/dsh-sleev#\$\{SLEEV_SETTINGS_NAMESPACE_ID\}`/u,
      "the seat key must join the package name to the namespace constant, not to a second literal",
    );
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
