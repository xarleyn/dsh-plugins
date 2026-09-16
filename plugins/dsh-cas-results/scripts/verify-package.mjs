/**
 * Package gate for @yadsh/dsh-cas-results (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, and packaged file list without hitting the network. The shared
 * checks come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-cas-results",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./package.json"],
  client: "none",
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "NOTICE.md",
    "LICENSE",
  ],
  patch: { headerComment: true, id: "dsh-cas-results" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/post-execute"],
  },
  extra: async ({ readFile }) => {
    // Attribution contract of the plugin (SPEC §2, §33 AC12).
    const readme = await readFile("README.md");
    assert.match(readme, /## Credits/);
    assert.match(readme, /dsh-funnel/);
    assert.match(readme, /YuanyuanMa03/);
    const notice = await readFile("NOTICE.md");
    assert.match(notice, /dsh-funnel/);
    assert.match(notice, /YuanyuanMa03/);

    // Docs.
    await readFile("SPEC.md");
  },
});
