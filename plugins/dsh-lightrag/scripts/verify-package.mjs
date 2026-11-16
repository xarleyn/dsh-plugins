/**
 * Package gate for @yadsh/dsh-lightrag (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest and the packaged file list without hitting the network, then checks
 * the documentation contract deployments rely on: the README names every tool
 * this plugin can register — an allow-list is built from that list — and keeps
 * the configuration table and the security model. The shared checks come from
 * @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-lightrag",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./client", "./locale/en.json", "./package.json"],
  exportsBuilt: true,
  client: {
    platform: "web",
    injectIncludes: [
      "@deepseek-ai/dsh-client-ui-plugin-manager",
      "@deepseek-ai/dsh-client-ui-settings",
    ],
  },
  files: [
    "lib",
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
    "locale/en.json",
    "README.md",
    "LICENSE",
  ],
  patch: { headerComment: true, id: "dsh-lightrag" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/register"],
    clientFeatures: ["plugins.row.config"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: ["plugins.row.config", "@yadsh/dsh-lightrag#dsh-lightrag"],
    notMatches: [/require\("node:/u, /"settings\.plugins\.tab"/u],
    cardContract: {},
  },
  extra: async ({ readFile }) => {
    // Import the compiled host entry as well as checking browser registration:
    // the HTTP client and browser bundle must coexist in the published package.
    const host = await import("../lib/index.js");
    assert.equal(typeof host.createLightRagClient, "function");
    // A deployment builds its `lockdown.toolPolicy.allow` / preset toolFilter
    // from the README's tool list, so a tool the README never names cannot be
    // granted — and one it names but never registers fails attestation. Both
    // halves are asserted here: the names, and the sections that explain them.
    const readme = await readFile("README.md");
    for (const toolName of [
      "dsh_lightrag_query",
      "dsh_lightrag_documents",
      "dsh_lightrag_status",
      "dsh_lightrag_insert",
      "dsh_lightrag_scan",
      "dsh_lightrag_delete",
    ]) {
      assert.match(
        readme,
        new RegExp(toolName, "u"),
        `README must document ${toolName}`,
      );
    }
    assert.match(readme, /## Configuration/u);
    assert.match(readme, /## Security model/u);
    // The write tools are off by default; a README that lost that sentence
    // would let a deployment enable them by accident.
    assert.match(readme, /writes\.enabled/u);
    assert.match(readme, /## Compatibility/u);
    assert.match(readme, /## License/u);

    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/u);
    assert.match(spec, /## 3\. Verified API contract/u);
  },
});
