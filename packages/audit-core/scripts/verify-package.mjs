// Package gate for @yadsh/dsh-audit-core. The package publishes no Cordis patch
// and no browser client, so the gate keeps the manifest contract and adds the
// one thing this package really is: the audit artifact schema its consumers
// write and parse.
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import {
  AUDIT_SCHEMA_VERSION,
  buildAuditSummary,
  parseAuditAnalysis,
  validateAuditAnalysis,
} from "../lib/index.js";
import { auditDirectoryName } from "../lib/paths.js";
import { publishAudit } from "../lib/producer/index.js";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-audit-core",
  license: "MIT",
  bundlePatch: false,
  client: "none",
  exports: [".", "./paths", "./producer", "./package.json"],
  exportDefaults: {
    ".": "./lib/index.js",
    "./paths": "./lib/paths.js",
    "./producer": "./lib/producer/index.js",
  },
  exportsBuilt: true,
  mainTypesMatchRootExport: true,
  publishedDependenciesResolve: true,
  files: ["lib", "README.md", "LICENSE"],
  requiredFiles: ["README.md", "LICENSE"],
  extra: () => {
    // Writer and readers are one contract: `dsh-model-safety-gate` publishes
    // through `publishAudit`, and `dsh-session-audit` / `dsh-qa-surface` read the
    // artifact back through the parser, the validator and the summary builder.
    // Each of those four is imported by name by one of them, so a rename here
    // breaks a plugin build that nothing in this package's own check would see.
    for (const [name, value] of Object.entries({
      parseAuditAnalysis,
      validateAuditAnalysis,
      buildAuditSummary,
      publishAudit,
    })) {
      assert.equal(typeof value, "function", `${name} must stay exported`);
    }
    // `./paths` is published for whoever reads an artifact directory, so the
    // name that lays the directory out is part of the surface too.
    assert.equal(
      typeof auditDirectoryName,
      "function",
      "auditDirectoryName must stay exported",
    );
    // The version an artifact carries is the version this package validates
    // against; a bump is a change to what every reader accepts.
    assert.equal(AUDIT_SCHEMA_VERSION, 1);
  },
});
