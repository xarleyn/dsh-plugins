/**
 * Package gate for @yadsh/dsh-answer-review-gate (guidelines §4, §6.3).
 *
 * Validates the manifest, the canonical bundle patch pair, the compatibility
 * manifest, and the packaged file list through the shared checker. The
 * plugin-specific extra asserts the deployment contract the README must
 * carry: the failure policy (a reviewer failure must never read as a PASS)
 * and the delegation-suppression behavior.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-answer-review-gate",
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
  patch: { headerComment: true, id: "dsh-answer-review-gate" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: [
      "agent/turn-stopping",
      "tools/result",
      "agent/inbox/inserted",
      "commands",
    ],
  },
  extra: async ({ readFile }) => {
    const readme = await readFile("README.md");
    // Failure policy is the user-facing safety contract: every mode is
    // documented, and the text states that reviewer failure is never a PASS.
    for (const mode of ["open", "warn", "closed"]) {
      assert.match(
        readme,
        new RegExp(`\`${mode}\``, "u"),
        `README must document failMode ${mode}`,
      );
    }
    assert.match(readme, /never .*PASS|never converted into a PASS/u);
    // Delegation suppression is the headline lifecycle guarantee.
    assert.match(readme, /background/u);
    // Both reviewer backends are documented with their stable identifiers.
    assert.match(readme, /domain-expert/u);
    assert.match(readme, /subagent/u);
    // A review waiver is explicit, structural and policy-controlled.
    assert.match(readme, /\/no-review <request>/u);
    assert.match(readme, /structured command contract/u);
    assert.match(readme, /allowedInClosedMode/u);
    assert.match(readme, /recordInput: false/u);
  },
});
