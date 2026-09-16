/**
 * Package gate for @yadsh/dsh-git-readonly (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest, the packaged file list, and the security-contract documentation
 * that deployments rely on, without hitting the network. The shared checks
 * come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-git-readonly",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./package.json"],
  client: "none",
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: ["lib/index.js", "lib/index.d.ts", "README.md", "LICENSE"],
  patch: { headerComment: true, id: "dsh-git-readonly" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/register"],
  },
  extra: async ({ readFile }) => {
    // Security-contract documentation: the README must name every registered
    // tool (deployment allow-lists are built from this list) and must document
    // the read-only security model; SPEC.md is the product contract.
    const readme = await readFile("README.md");
    for (const toolName of [
      "dsh_git_context",
      "dsh_git_history",
      "dsh_git_show",
      "dsh_git_blame",
    ]) {
      assert.match(
        readme,
        new RegExp(toolName, "u"),
        `README must document ${toolName}`,
      );
    }
    assert.match(readme, /## Security model/u);
    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/u);
    assert.match(spec, /## 9\. Mutation test contract/u);
  },
});
