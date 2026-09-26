// Package gate for @yadsh/dsh-plugin-log. A shared package publishes no Cordis
// patch and no browser client, so the gate holds the manifest contract that does
// apply — the export surface built, the `files` whitelist, no `dsh.client` — and
// the two things packing cannot show: `main`/`types` naming the root export, and
// a published range a registry consumer can install. Whether the artifact ships
// each export is `pnpm tarball:verify`, which CI runs per publishable project.
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-plugin-log",
  license: "MIT",
  bundlePatch: false,
  client: "none",
  exports: [".", "./package.json"],
  exportDefaults: { ".": "./lib/index.js" },
  exportsBuilt: true,
  mainTypesMatchRootExport: true,
  publishedDependenciesResolve: true,
  files: ["lib", "README.md", "LICENSE"],
  requiredFiles: ["README.md", "LICENSE"],
});
