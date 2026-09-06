import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validatePublishablePlugin } from "./verify-package-hygiene.mjs";

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-package-hygiene-"));
  for (const file of ["cordis.patch.yml", "LICENSE", "README.md"]) {
    writeFileSync(path.join(directory, file), `${file}\n`);
  }
  writeJson(path.join(directory, "compatibility.json"), {
    deepseekHarness: {
      range: ">=0.1.1-rc.2 <0.2.0",
      testedReleases: ["0.1.1-rc.2"],
    },
    node: ">=22",
  });
  writeJson(path.join(directory, "package.json"), {
    name: "@yadsh/dsh-fixture",
    version: "0.0.0",
    types: "./lib/index.d.ts",
    exports: {
      ".": { types: "./lib/index.d.ts", default: "./lib/index.js" },
      "./package.json": "./package.json",
    },
    files: [
      "lib",
      "compatibility.json",
      "cordis.patch.yml",
      "LICENSE",
      "README.md",
    ],
    engines: { node: ">=22" },
    ...overrides,
  });
  return directory;
}

test("accepts the plain tsc declaration layout", async () => {
  const directory = await fixture();
  try {
    assert.deepEqual(validatePublishablePlugin(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts the bundled multi-entry declaration layout", async () => {
  const directory = await fixture({
    types: "./lib/types/index.d.ts",
    exports: {
      ".": {
        types: "./lib/types/index.d.ts",
        default: "./lib/index.js",
      },
      "./client": {
        types: "./lib/types/client/index.d.ts",
        default: "./lib/client.js",
      },
      "./package.json": "./package.json",
    },
  });
  try {
    assert.deepEqual(validatePublishablePlugin(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects missing canonical package metadata", async () => {
  const directory = await fixture({
    exports: {
      ".": { types: "./lib/custom/index.d.ts", default: "./lib/index.js" },
    },
    types: "./lib/custom/index.d.ts",
    files: ["lib", "cordis.patch.yml", "README.md"],
  });
  try {
    const errors = validatePublishablePlugin(directory);
    assert.ok(errors.some((error) => error.includes("LICENSE")));
    assert.ok(errors.some((error) => error.includes("compatibility.json")));
    assert.ok(errors.some((error) => error.includes("./package.json")));
    assert.ok(errors.some((error) => error.includes("declaration layout")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
