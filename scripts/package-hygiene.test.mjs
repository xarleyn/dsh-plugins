import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validatePublishablePlugin, validateVersionPlan } from "./verify-package-hygiene.mjs";

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
      range: ">=0.1.5-rc.2 <0.2.0",
      testedReleases: ["0.1.5-rc.2"],
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

const knownProjects = new Set(["@yadsh/dsh-doc-impact"]);
const versionPlan = [
  "---",
  '"@yadsh/dsh-doc-impact": patch',
  "---",
  "",
  "Fix the settings card.",
  "",
].join("\n");

test("accepts a well-formed version plan", () => {
  assert.deepEqual(
    validateVersionPlan("plan.md", versionPlan, knownProjects),
    [],
  );
});

test("accepts a version plan written with CRLF line endings", () => {
  assert.deepEqual(
    validateVersionPlan(
      "plan.md",
      versionPlan.replaceAll("\n", "\r\n"),
      knownProjects,
    ),
    [],
  );
});

test("rejects a version plan without the opening front-matter fence", () => {
  const errors = validateVersionPlan(
    "plan.md",
    versionPlan.replace(/^---\n/u, ""),
    knownProjects,
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /must open with --- on the first line/u);
});

test("rejects a version plan nx cannot resolve", () => {
  const errors = validateVersionPlan(
    "plan.md",
    [
      "---",
      '"@yadsh/dsh-unknown": patch',
      '"@yadsh/dsh-doc-impact": soon',
      "---",
      "",
    ].join("\n"),
    knownProjects,
  );

  assert.ok(
    errors.some((error) => error.includes("is not a workspace package")),
    `expected an unknown-package error, got ${JSON.stringify(errors)}`,
  );
  assert.ok(
    errors.some((error) => error.includes("is not a release type")),
    `expected a release-type error, got ${JSON.stringify(errors)}`,
  );
  assert.ok(
    errors.some((error) => error.includes("add a changelog message")),
    `expected a changelog-message error, got ${JSON.stringify(errors)}`,
  );
});
