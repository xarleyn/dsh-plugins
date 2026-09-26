// Package gate for @yadsh/dsh-audit-ui. The package publishes no Cordis patch
// and no browser bundle of its own — its consumers inline it — so the gate keeps
// the manifest contract and the two promises `dsh-session-audit` and
// `dsh-qa-surface` build against beyond its types: a model-written report that
// reaches the DOM through the sanitizer, and a sheet that colours itself with
// theme tokens alone.
import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import { AUDIT_UI_STYLES, renderReport, safeHref } from "../lib/index.js";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-audit-ui",
  license: "MIT",
  bundlePatch: false,
  client: "none",
  exports: [".", "./package.json"],
  exportDefaults: { ".": "./lib/index.js" },
  exportsBuilt: true,
  mainTypesMatchRootExport: true,
  publishedDependenciesResolve: true,
  files: ["lib", "README.md", "LICENSE"],
  extra: () => {
    assert.equal(typeof renderReport, "function");
    // A report is model-written markdown, so the sanitizer is part of the
    // published surface, not only of the test suite: an unsafe link must never
    // reach an `href`.
    assert.equal(safeHref("javascript:alert(1)"), undefined);
    assert.equal(
      safeHref("https://example.test/report"),
      "https://example.test/report",
    );

    // The sheet's own comment states the rule; a literal in it renders the same
    // in every theme, which is how a dark panel loses its text.
    assert.match(AUDIT_UI_STYLES, /--dsw-alias-/u);
    assert.doesNotMatch(AUDIT_UI_STYLES, /#(?:[0-9a-f]{3}){1,2}\b|rgba?\(/iu);
  },
});
