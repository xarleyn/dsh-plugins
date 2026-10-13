import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  writeJson,
  workspaceFixture,
} from "./test-support/package-hygiene-fixtures.mjs";
import {
  validatePublishablePlugin,
  validatePublishableSharedPackage,
  validateVersionPlan,
  validateWorkspaceScripts,
} from "./verify-package-hygiene.mjs";

async function fixture(overrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "dsh-package-hygiene-"));
  for (const file of ["cordis.patch.yml", "LICENSE", "README.md"]) {
    writeFileSync(path.join(directory, file), `${file}\n`);
  }
  mkdirSync(path.join(directory, "locale"), { recursive: true });
  writeJson(path.join(directory, "locale", "en.json"), {
    meta: { title: "Fixture", description: "A fixture plugin." },
  });
  writeJson(path.join(directory, "compatibility.json"), {
    deepseekHarness: {
      range: ">=0.1.7-rc.2 <0.2.0",
      testedReleases: ["0.1.7-rc.2"],
    },
    node: ">=22",
  });
  writeJson(path.join(directory, "package.json"), {
    name: "@yadsh/dsh-fixture",
    version: "0.0.0",
    types: "./lib/index.d.ts",
    exports: {
      ".": { types: "./lib/index.d.ts", default: "./lib/index.js" },
      "./locale/en.json": "./locale/en.json",
      "./package.json": "./package.json",
    },
    files: [
      "lib",
      "locale/*.json",
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

const GATE_CALL =
  "runVerifyPackage({ mainTypesMatchRootExport: true, publishedDependenciesResolve: true });\n";

function writeGateScript(directory, name, source) {
  mkdirSync(path.join(directory, "scripts"), { recursive: true });
  writeFileSync(path.join(directory, "scripts", name), source);
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
      "./locale/en.json": "./locale/en.json",
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

test("rejects a bundle that leaves its Plugins panel row unnamed", async () => {
  // The Host titles and describes the row from `<package>/locale/en.json`, read
  // through the exports map without activating the plugin. Without the file, or
  // with a field that is empty or not a string, the row is named by its full
  // package specifier — and a tarball that omits the locale directory shows the
  // same fallback on an installed deployment even though the source has it.
  const directory = await fixture();
  try {
    rmSync(path.join(directory, "locale", "en.json"));
    assert.deepEqual(validatePublishablePlugin(directory), [
      "locale/en.json is missing; without it the Plugins panel names this row by its package specifier",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const unpublished = await fixture({
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
  });
  try {
    assert.deepEqual(validatePublishablePlugin(unpublished), [
      'exports["./locale/en.json"] must equal "./locale/en.json"; the Host reads the row name through the exports map',
      "locale/en.json is missing from package.json files",
    ]);
  } finally {
    await rm(unpublished, { recursive: true, force: true });
  }

  const blank = await fixture();
  try {
    writeJson(path.join(blank, "locale", "en.json"), {
      meta: { title: "  ", description: null },
    });
    const errors = validatePublishablePlugin(blank);
    assert.ok(
      errors.some((error) =>
        error.includes("meta.title must be a non-empty string"),
      ),
      errors.join("\n"),
    );
    assert.ok(
      errors.some((error) =>
        error.includes("meta.description must be a non-empty string"),
      ),
      errors.join("\n"),
    );
  } finally {
    await rm(blank, { recursive: true, force: true });
  }
});

test("requires a package gate on a publishable shared package", async () => {
  // A shared package without `verify` still publishes, and nothing asks whether
  // its declared exports were built or its published ranges resolve.
  const ungated = await fixture();
  try {
    assert.deepEqual(validatePublishableSharedPackage(ungated), [
      "scripts.verify is required for every publishable shared package",
    ]);
  } finally {
    await rm(ungated, { recursive: true, force: true });
  }

  const gated = await fixture({
    scripts: { verify: "pnpm run verify:package" },
  });
  try {
    writeGateScript(gated, "verify-package.mjs", GATE_CALL);
    assert.deepEqual(validatePublishableSharedPackage(gated), []);
  } finally {
    await rm(gated, { recursive: true, force: true });
  }
});

test("keeps the shared package gate on what packing cannot show", async () => {
  // A `verify` that exists but stopped passing the options would exit 0 while the
  // docs next to it still promise the two checks, so the script is read too.
  const narrowed = await fixture({
    scripts: { verify: "pnpm run verify:package" },
  });
  try {
    writeGateScript(
      narrowed,
      "verify-package.mjs",
      "runVerifyPackage({ exportsBuilt: true });\n",
    );
    assert.deepEqual(validatePublishableSharedPackage(narrowed), [
      "no script under scripts/ calls runVerifyPackage with mainTypesMatchRootExport and publishedDependenciesResolve enabled; a shared package gate keeps both options on — packing cannot show either",
    ]);

    // One option dropped is the more likely accident: a refactor that keeps the
    // other and still prints "all gates passed".
    writeGateScript(
      narrowed,
      "verify-package.mjs",
      "runVerifyPackage({ mainTypesMatchRootExport: true });\n",
    );
    assert.deepEqual(validatePublishableSharedPackage(narrowed), [
      "no script under scripts/ calls runVerifyPackage with publishedDependenciesResolve enabled; a shared package gate keeps both options on — packing cannot show either",
    ]);

    // The call is what carries the options, so prose naming them helps nobody.
    writeGateScript(
      narrowed,
      "verify-package.mjs",
      "// mainTypesMatchRootExport: true\nrunVerifyPackage({ exportsBuilt: true });\n",
    );
    assert.equal(validatePublishableSharedPackage(narrowed).length, 1);

    // An option turned off is not turned on.
    writeGateScript(
      narrowed,
      "verify-package.mjs",
      "runVerifyPackage({ mainTypesMatchRootExport: true, publishedDependenciesResolve: false });\n",
    );
    assert.equal(validatePublishableSharedPackage(narrowed).length, 1);
  } finally {
    await rm(narrowed, { recursive: true, force: true });
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

test("rejects an unquoted scoped package key that Nx cannot parse as YAML", () => {
  const errors = validateVersionPlan(
    "plan.md",
    versionPlan.replace('"@yadsh/dsh-doc-impact"', "@yadsh/dsh-doc-impact"),
    knownProjects,
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0], /quote scoped package names.*YAML/u);
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

test("accepts the canonical plugin script pipeline", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-fixture": {
        name: "@yadsh/dsh-fixture",
        scripts: {
          lint: "eslint src tests scripts",
          typecheck: "tsc --noEmit",
          test: "vitest run",
          build: "tsc -p tsconfig.build.json",
          "verify:package": "node scripts/verify-package.mjs",
          verify: "pnpm run verify:package",
          check:
            "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run verify",
          prepack: "pnpm run build && pnpm run verify",
        },
      },
    },
  });
  const directory = path.join(root, "plugins", "dsh-fixture");
  try {
    assert.deepEqual(validateWorkspaceScripts(directory, { plugin: true }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects stale package-manager and missing-script references", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-fixture": {
        name: "@yadsh/dsh-fixture",
        scripts: {
          lint: "eslint src tests scripts",
          typecheck: "tsc --noEmit",
          test: "vitest run",
          build: "npm run clean && tsc -p tsconfig.build.json",
          "verify:package": "node scripts/verify-package.mjs",
          verify: "pnpm run verify:package",
          check:
            "pnpm run format && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run verify",
          prepack: "tsc -p tsconfig.build.json",
        },
      },
    },
  });
  const directory = path.join(root, "plugins", "dsh-fixture");
  try {
    const errors = validateWorkspaceScripts(directory, { plugin: true });
    assert.ok(errors.some((error) => error.includes("use pnpm, not npm")));
    assert.ok(
      errors.some((error) => error.includes('missing local script "clean"')),
    );
    assert.ok(
      errors.some((error) => error.includes('missing local script "format"')),
    );
    assert.ok(
      errors.some((error) => error.includes("scripts.check must equal")),
    );
    assert.ok(errors.some((error) => error.includes("scripts.prepack")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
