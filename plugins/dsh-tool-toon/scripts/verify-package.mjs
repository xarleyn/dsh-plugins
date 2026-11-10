import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-tool-toon",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./locale/en.json", "./package.json"],
  client: "none",
  files: [
    "lib",
    "locale",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: ["lib/index.js", "lib/index.d.ts", "README.md", "LICENSE"],
  patch: { headerComment: true, id: "dsh-tool-toon" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/post-execute"],
  },
  extra: async ({ readFile }) => {
    const readme = await readFile("README.md");
    assert.match(readme, /minSavingsBytes/u);
    assert.match(readme, /tokenizer/u);
    assert.match(
      await readFile("lib/post-execute.js"),
      /resolvePostExecuteContent/u,
    );
    assert.match(await readFile("lib/format.js"), /isDeepStrictEqual/u);
  },
});
