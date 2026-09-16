/**
 * Package gate for @yadsh/dsh-kv-persist (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, and packaged file list without hitting the network. The shared
 * checks come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-kv-persist",
  license: "MIT",
  exports: [".", "./package.json"],
  files: [
    "lib",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  patch: { headerComment: true, id: "dsh-kv-persist" },
  compatibility: { range: true, testedReleases: true, node: "nonEmpty" },
  extra: async ({ readFile }) => {
    // Docs.
    await readFile("README.md");
    await readFile("SPEC.md");
  },
});
