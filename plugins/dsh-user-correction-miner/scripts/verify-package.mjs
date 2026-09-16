/**
 * Package gate for @yadsh/dsh-user-correction-miner (guidelines §4, §6.3).
 *
 * Validates the manifest, canonical bundle patch pair, compatibility
 * manifest, and packaged file list without hitting the network. The shared
 * checks come from @yadsh/dsh-plugin-scripts/run-verify-package.
 */
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-user-correction-miner",
  exports: [".", "./package.json"],
  patch: { id: "dsh-user-correction-miner" },
  compatibility: { hostFeatures: ["session-query", "storage-domain"] },
  requiredFiles: ["lib/index.js", "lib/index.d.ts", "README.md", "LICENSE"],
  extra: ({ manifest }) => {
    assert.equal(
      manifest.dependencies?.["@yadsh/dsh-plugin-log"],
      "workspace:^",
    );
  },
});
