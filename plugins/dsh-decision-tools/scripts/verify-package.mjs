import assert from "node:assert/strict";
import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";
import {
  createTools,
  DecisionClient,
  resolveConfig,
  TOOL_NAMES,
} from "../lib/index.js";
import {
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
} from "@deepseek-ai/dsh-tools";
await runVerifyPackage({
  packageRoot: new URL("../", import.meta.url),
  packageName: "@yadsh/dsh-decision-tools",
  license: "MIT",
  enginesNodeMatchesCompatibility: true,
  exports: [".", "./package.json", "./locale/en.json"],
  client: "none",
  files: [
    "lib",
    "locale/*.json",
    "cordis.patch.yml",
    "compatibility.json",
    "README.md",
    "LICENSE",
  ],
  requiredFiles: [
    "lib/index.js",
    "lib/index.d.ts",
    "locale/en.json",
    "SPEC.md",
  ],
  patch: { headerComment: true, id: "dsh-decision-tools" },
  compatibility: {
    range: true,
    testedReleases: true,
    hostFeatures: ["tools/register"],
  },
  extra: async ({ readFile }) => {
    const readme = await readFile("README.md");
    for (const name of TOOL_NAMES)
      assert.ok(readme.includes(name), `README must document ${name}`);
    const client = new DecisionClient(resolveConfig());
    const tools = createTools(client);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...TOOL_NAMES],
    );
    for (const tool of tools) {
      assertObjectJsonSchema(tool.parameters);
      assertSupportedJsonSchema(tool.output.schema);
    }
    client.close();
    const locale = JSON.parse(await readFile("locale/en.json"));
    assert.ok(locale.meta.title && locale.meta.description);
    assert.match(await readFile("SPEC.md"), /## 1\. Product contract/u);
  },
});
