import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import { buildPrompt } from "../lib/prompt.js";
import plugin from "../lib/index.js";

await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-humanizer",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./package.json", "./locale/en.json"],
  client: "none",
  files: [
    "lib",
    "locale",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE-APACHE-2.0",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/index.d.ts",
    "lib/prompt.js",
    "locale/en.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE-APACHE-2.0",
  ],
  patch: { headerComment: true, id: "dsh-humanizer" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/register"],
  },
  extra: async ({ readFile }) => {
    assert.equal(
      createHash("sha256").update(buildPrompt("X")).digest("hex").slice(0, 16),
      "cc51d66b4c593fbe",
    );
    assert.deepEqual(plugin.inject, ["tools"]);
    assert.ok(plugin.Config);
    const readme = await readFile("README.md");
    for (const word of [
      "dsh_humanize_text",
      "dsh_humanizer_status",
      "protectedPhrases",
      "DSH_HUMANIZER_API_KEY",
      "## Security model",
      "## Quality limits",
    ])
      assert.ok(readme.includes(word), word);
    const spec = await readFile("SPEC.md");
    assert.match(spec, /## 1\. Product contract/u);
    assert.match(spec, /## 3\. Verified API contract/u);
  },
});
