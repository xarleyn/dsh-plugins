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
    testedReleases: ["0.1.7-rc.2"],
    clientFeatures: ["settings.plugins.tab"],
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
    includes: ["settings.plugins.tab", "dsh-jev-compaction"],
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
    // expose both seams the SPEC depends on. Since 0.1.7 the namespace is not
    // free-floating: it is the profile entry id the loader keys the volatile
    // section by, so the patch manifest is the third party to that agreement.
    const settingsModule = await read("lib/shared/settings.js");
    assert.match(
      settingsModule,
      /JEV_COMPACTION_SETTINGS_NAMESPACE\s*=\s*"dsh-jev-compaction"/u,
      "the settings namespace constant is the join key with the card",
    );
    assert.match(
      await read("cordis.patch.yml"),
      /id:\s*dsh-jev-compaction\b/u,
      "the profile entry id the namespace is derived from",
    );
    assert.match(
      client ?? "",
      /"dsh-jev-compaction"/u,
      "the card resolves the same entry section the Host serves",
    );
    assert.match(
      client ?? "",
      /configForms/u,
      "the card reads the Host settings form, not a plugin-owned namespace",
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
      "the service declines the generated page for the section the card writes to",
    );
    assert.match(
      serviceModule,
      /loader\/volatile-update/u,
      "the service re-resolves when the loader moves a volatile field",
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

// The settings card registers under `settings.plugins.tab` and keeps our own
// shell (decision D1 of the 0.1.7 cutover), so the compiled browser bundle has
// to satisfy the shared card shell contract.
verifyPluginCardContract(
  await readFile(
    new URL("lib/client.js", new URL("../", import.meta.url)),
    "utf8",
  ),
);
