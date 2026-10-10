import assert from "node:assert/strict";
import { runVerifyPackage } from "../../../packages/plugin-scripts/run-verify-package.mjs";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-llm-provider-extended",
  exports: [".", "./client", "./locale/en.json"],
  exportsBuilt: true,
  mainTypesMatchRootExport: true,
  publishedDependenciesResolve: true,
  enginesNodeMatchesCompatibility: true,
  patch: { headerComment: true, id: "dsh-llm-provider-extended" },
  files: [
    "lib",
    "locale",
    "README.md",
    "LICENSE",
    "NOTICE.md",
    "UPSTREAM_LICENSE",
  ],
  compatibility: {
    range: true,
    testedReleases: ["0.1.7-rc.2"],
    clientFeatures: ["plugins.row.config", "configForms"],
  },
  client: {
    platform: "web",
    injectIncludes: [
      "@deepseek-ai/dsh-client-ui-plugin-manager",
      "@deepseek-ai/dsh-client-ui-settings",
    ],
  },
  clientBundle: {
    moduleLoaderId: true,
    cardContract: {},
    includes: ["plugins.row.config", "Temperature", "systemone"],
    notMatches: [
      /require\(["'](?:node:|fs["']|path["']|process["'])/u,
      /require\(["']\.\.?\//u,
    ],
  },
  extra: async ({ manifest, readFile }) => {
    assert.equal(manifest.dependencies["@earendil-works/pi-ai"], "0.85.1");
    assert.match(
      await readFile("NOTICE.md"),
      /477b4f420553e8a52c2fbccc464d7561b239c443/u,
    );
  },
});
