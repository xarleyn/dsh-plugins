/**
 * Package gate for @yadsh/dsh-domain-experts (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest, the packaged file list, the built host and browser artifacts, and
 * the two contracts deployment relies on: the settings tab registration and
 * the enforcement vocabulary the README promises. Runs offline. The shared
 * checks come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

const PACKAGE_NAME = "@yadsh/dsh-domain-experts";
const RUNTIME_ID = "dsh-domain-experts";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: PACKAGE_NAME,
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  // Exports: exhaustive public surface, types mirroring the root entry.
  exports: [
    ".",
    "./client",
    "./remote",
    "./typert",
    "./types",
    "./package.json",
  ],
  exportDefaults: {
    "./client": "./lib/client.js",
    "./remote": "./lib/typert.remote-client.js",
    "./typert": "./lib/typert.host.js",
  },
  client: {
    platform: "web",
    injectIncludes: ["@deepseek-ai/dsh-client-ui-settings"],
  },
  files: [
    "lib/**/*.js",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/types/index.d.ts",
    "lib/types.js",
    "lib/types/types.d.ts",
    "lib/client.js",
    "lib/client.js.map",
    "lib/types/client/index.d.ts",
    "lib/typert.host.js",
    "lib/typert.host.d.ts",
    "lib/typert.remote-client.js",
    "lib/typert.remote-client.d.ts",
    "README.md",
    "LICENSE",
  ],
  patch: { headerComment: true, id: RUNTIME_ID },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/register", "subagents.start", "storageDomain.open"],
    clientFeatures: ["settings.plugins.tab"],
  },
  clientBundle: {
    moduleLoaderId: true,
    includes: ["settings.plugins.tab", "domain-experts", "Domain Experts"],
    notMatches: [
      // The negative assertions are the deliberate half: this plugin ships no
      // card shell, so the canonical card CSS must not appear in the bundle.
      /dsh-plugin-card/u,
      /@yadsh\/dsh-plugin-log/u,
      /from\s+["']node:/u,
    ],
  },
  extra: async ({ manifest, readFile }) => {
    // Manifest identity (tarball gate 2 checks the packed copy of the same fields).
    assert.equal(manifest.repository?.directory, "plugins/dsh-domain-experts");
    assert.equal(manifest.types, manifest.exports["."].types);

    // The generated Remote contract exposes the service the client calls.
    const remote = await readFile("lib/typert.remote-client.js");
    for (const method of [
      "domainExperts/listDomains",
      "domainExperts/getDomain",
      "domainExperts/createDomain",
      "domainExperts/updateDomain",
      "domainExperts/resolveScope",
      "domainExperts/inspectMemory",
      "domainExperts/testExpert",
    ]) {
      assert.match(
        remote,
        new RegExp(method.replace("/", "/"), "u"),
        `remote is missing ${method}`,
      );
    }
    const hostRemote = await readFile("lib/typert.host.js");
    assert.match(hostRemote, /domainExperts/u);

    // The host entry must not pull in the browser half.
    const host = await readFile("lib/index.js");
    assert.doesNotMatch(
      host,
      /\.\/client\//u,
      "the host entry must not import src/client",
    );
    assert.match(host, /domainExperts/u);

    // Documentation contract: the README names every registered tool (operator
    // allow-lists are built from that list) and documents the enforcement
    // vocabulary; SPEC.md is the product contract.
    const readme = await readFile("README.md");
    for (const toolName of [
      "domain_expert",
      "domain_experts_list",
      "domain_memory",
    ]) {
      assert.match(
        readme,
        new RegExp(toolName, "u"),
        `README must document ${toolName}`,
      );
    }
    assert.match(readme, /## Enforcement model/u);
    assert.match(readme, /enforced/u);
    assert.match(readme, /advisory/u);

    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/u);
    assert.match(spec, /## 4\. Scope: Included \/ Deferred/u);
    assert.match(spec, /## 6\. Implementation status/u);
  },
});
