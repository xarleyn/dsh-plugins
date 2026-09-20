/**
 * Package gates for @yadsh/dsh-jev-compaction. Run after `pnpm build`: the
 * tarball has to carry the compiled Host runtime, the browser settings card
 * and the canonical bundle patch. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package; the plugin-specific ones
 * assert the two seams this package depends on — the settings namespace the
 * card joins on, and the browser bundle's purity (no Node built-ins, no API
 * secret in the page).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import { verifyPluginCardContract } from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-jev-compaction",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./backend", "./client", "./package.json"],
  exportDefaults: {
    ".": "./lib/index.js",
    "./backend": "./lib/backend/index.js",
    "./client": "./lib/client.js",
  },
  client: {
    platform: "web",
    injectEquals: [
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
    ],
  },
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
    "NOTICE.md",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/index.d.ts",
    "lib/backend/index.js",
    "lib/client.js",
    "lib/client/index.d.ts",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
    "NOTICE.md",
  ],
  patch: { headerComment: true, id: "dsh-jev-compaction" },
  compatibility: {
    node: "matchesEngines",
    testedReleases: ["0.1.5-rc.2"],
    clientFeatures: ["settings.plugin.item"],
  },
  clientBundle: {
    moduleLoaderId: true,
    cardContract: {
      legacyPatterns: [
        // The card never had an older shell, but pin the rule against the
        // plugin-specific outer shells the guidelines forbid.
        /\.jevc-card\b/u,
        /dsh-plugin-card\s*\*/u,
      ],
    },
    includes: ["settings.plugin.item", "jev-compaction"],
    notMatches: [
      // The bundle is browser-only: a Node built-in import here would break
      // the host page's module table (client-bundle purity).
      /require\("node:/u,
      /from\s*"node:/u,
      // The card edits the *name* of the API-key variable; a resolved secret
      // value must never be bundled or rendered.
      /Bearer /u,
    ],
  },
  extra: async ({ manifest, client, readFile: read }) => {
    // DSH runtime packages are peers, never bundled dependencies.
    assert.equal(manifest.dependencies["@deepseek-ai/cordis"], undefined);
    for (const name of Object.keys(manifest.peerDependencies)) {
      if (!name.startsWith("@deepseek-ai/")) continue;
      assert.notEqual(
        manifest.devDependencies[name],
        undefined,
        `${name} needs a dev copy`,
      );
      assert.equal(
        manifest.dependencies[name],
        undefined,
        `${name} must not be a dependency`,
      );
    }

    // The card is config-only: no Remote namespace may appear in the client
    // inject list.
    assert.deepEqual(
      manifest.dsh.client.external,
      ["@deepseek-ai/dsh-client-ui-slots"],
      "the card keeps the slot registry external",
    );

    // Host and client must agree on the settings namespace, and the Host must
    // expose both seams the SPEC depends on.
    const settingsModule = await read("lib/shared/settings.js");
    assert.match(
      settingsModule,
      /JEV_COMPACTION_SETTINGS_NAMESPACE\s*=\s*"jev-compaction"/u,
      "the settings namespace constant is the join key with the card",
    );
    assert.match(
      client ?? "",
      /"jev-compaction"/u,
      "the card binds the same settings namespace as the Host section",
    );

    const serviceModule = await read("lib/service.js");
    assert.match(
      serviceModule,
      /agent\/pre-step/u,
      "the service registers the historical compaction listener",
    );
    assert.match(
      serviceModule,
      /installJevCompactionSettings/u,
      "the service installs the settings section the card writes to",
    );
    assert.match(
      serviceModule,
      /tools\/post-execute/u,
      "the service registers the immediate result-shaping listener",
    );

    const compatibility = JSON.parse(await read("compatibility.json"));
    assert.ok(
      compatibility.deepseekHarness.requiredHostFeatures.includes(
        "tools/post-execute",
      ),
      "immediate shaping depends on the tools/post-execute waterfall",
    );
  },
});

// The settings card registers under `settings.plugin.item`, so the compiled
// browser bundle has to satisfy the shared card shell contract.
verifyPluginCardContract(
  await readFile(
    new URL("lib/client.js", new URL("../", import.meta.url)),
    "utf8",
  ),
);
