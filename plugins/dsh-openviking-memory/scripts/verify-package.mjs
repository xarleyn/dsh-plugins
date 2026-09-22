/**
 * Package gates for @yadsh/dsh-openviking-memory. Run after `pnpm build`:
 * the tarball has to carry the compiled host runtime, the browser settings
 * card, the canonical bundle patch, the vendored skill, the MCP proxy
 * entrypoint, and the Apache-2.0 attribution files required by the upstream
 * licence. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import { verifyPluginCardContract } from "@yadsh/dsh-plugin-scripts/verify-plugin-card-contract";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-openviking-memory",
  license: "Apache-2.0",
  exports: [
    ".",
    "./client",
    "./types",
    "./remote",
    "./typert",
    "./package.json",
  ],
  client: {
    platform: "web",
    injectEquals: [
      // The bundle mounts a Remote contribution, so the loader has to bring the
      // gateway client up before this entry applies — the same ordering every
      // other Remote plugin in this repository declares.
      "@deepseek-ai/dsh-api-gateway",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
      // The account-scoped page mounts into the QA settings dialog, so the QA
      // client half has to be in the page before this bundle registers it.
      "@yadsh/dsh-qa-surface",
    ],
  },
  files: [
    "lib",
    "skills",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/index.d.ts",
    "lib/client.js",
    "lib/client/index.d.ts",
    "lib/servers/mcp-proxy.js",
    "lib/openviking/mcp-proxy-core.js",
    "skills/openviking-memory/SKILL.md",
    "README.md",
    "LICENSE",
    "UPSTREAM.md",
  ],
  patch: { id: "dsh-openviking-memory" },
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
        /\.ovm-card\b/u,
        /dsh-plugin-card\s*\*/u,
      ],
    },
    notMatches: [
      // The bundle is browser-only: a Node built-in import here would break
      // the host page's module table (client-bundle purity).
      /require\("node:/u,
      /from\s*"node:/u,
    ],
  },
  extra: async ({ manifest, readFile }) => {
    // Derived package: the upstream project is Apache-2.0 and this package
    // must keep that licence rather than inherit the repository's MIT one.
    const license = await readFile("LICENSE");
    assert.match(license, /Apache License/u);
    assert.match(license, /Version 2\.0, January 2004/u);
    const upstream = await readFile("UPSTREAM.md");
    assert.match(upstream, /https:\/\/github\.com\/volcengine\/OpenViking/u);
    assert.match(upstream, /@openviking\/dsh-memory-plugin/u);
    assert.match(upstream, /688f78e923d2269d96c27096fe2dad10156ebdb8/u);
    assert.match(upstream, /not an official OpenViking distribution/u);

    // DSH runtime packages are peers, never bundled dependencies.
    assert.equal(manifest.dependencies["@deepseek-ai/cordis"], undefined);
    for (const name of Object.keys(manifest.peerDependencies)) {
      if (!name.startsWith("@deepseek-ai/")) continue;
      assert.equal(
        manifest.devDependencies[name] !== undefined,
        true,
        `${name} needs a dev copy`,
      );
      assert.equal(
        manifest.dependencies[name],
        undefined,
        `${name} must not be a dependency`,
      );
    }

    // Only the slot registry is provided by the page; every other dependency
    // travels inside this bundle.
    assert.deepEqual(
      manifest.dsh.client.external,
      ["@deepseek-ai/dsh-client-ui-slots"],
      "the card keeps the slot registry external",
    );

    // The account-scoped page is a Remote client: its artifact ships in the
    // tarball, and the package publishes the subpath it is reached by. A
    // published subpath with no built file is caught by the shared gate.
    for (const entry of [
      "lib/typert.host.js",
      "lib/typert.remote-client.js",
      "lib/types.js",
    ]) {
      assert.ok(
        manifest.files.includes("lib"),
        `${entry} needs the lib directory published`,
      );
    }

    // The generated Remote artifacts are the account-scoped page's whole
    // contract: a missing method there is a page that silently cannot save.
    const remoteClient = await readFile("lib/typert.remote-client.js");
    const hostArtifact = await readFile("lib/typert.host.js");
    for (const method of [
      "userMemorySettings",
      "setUserMemorySettings",
      "resetUserMemorySettings",
    ]) {
      assert.match(
        remoteClient,
        new RegExp(`openvikingMemory/${method}`, "u"),
        `the Remote client artifact carries ${method}`,
      );
      assert.match(
        hostArtifact,
        new RegExp(`openvikingMemory/${method}`, "u"),
        `the Host artifact describes ${method}`,
      );
    }
    // The boundary types the page exchanges must stay reachable from ./types.
    const types = await readFile("lib/types.js");
    assert.ok(types !== undefined, "./types is built");

    const clientBundle = await readFile("lib/client.js");
    assert.match(
      clientBundle,
      /qaUserSettingsSections/u,
      "the account-scoped page mounts into the QA settings dialog",
    );
    assert.match(
      clientBundle,
      /"openviking-memory"/u,
      "the page registers under its own section id",
    );

    const proxy = await readFile("lib/servers/mcp-proxy.js");
    assert.match(proxy, /createOpenVikingMcpProxy/u);
    assert.doesNotMatch(
      proxy,
      /^#!\/usr\/bin\/env/u,
      "proxy is spawned via process.execPath, not a shebang",
    );

    const skill = await readFile("skills/openviking-memory/SKILL.md");
    assert.match(skill, /^---\nname: openviking-memory\n/u);
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
