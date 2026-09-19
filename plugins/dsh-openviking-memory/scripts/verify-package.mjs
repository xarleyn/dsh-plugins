/**
 * Package gates for @yadsh/dsh-openviking-memory. Run after `pnpm build`:
 * the tarball has to carry the compiled host runtime, the browser settings
 * card, the canonical bundle patch, the vendored skill, the MCP proxy
 * entrypoint, and the Apache-2.0 attribution files required by the upstream
 * licence. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-openviking-memory",
  license: "Apache-2.0",
  exports: [".", "./client", "./package.json"],
  client: {
    platform: "web",
    injectEquals: [
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
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

    // The card is config-only: no Remote namespace may appear in the client
    // inject list.
    assert.deepEqual(
      manifest.dsh.client.external,
      ["@deepseek-ai/dsh-client-ui-slots"],
      "the card keeps the slot registry external",
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
