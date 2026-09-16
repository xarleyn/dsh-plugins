import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildManifest,
  findManifestDrift,
  serializeManifest,
} from "./generate-plugins-manifest.mjs";
import {
  compareVersions,
  curatedChangelogVersions,
  incrementVersion,
  planBumpFor,
  planProjects,
  validateClientContractGates,
  validateDiscoverability,
  validatePublishedContent,
  validatePublishablePlugin,
  validateVersionPlan,
  validateWorkspaceScripts,
  verifyVersionPlans,
} from "./verify-package-hygiene.mjs";

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

const CANONICAL_REPOSITORY = {
  type: "git",
  url: "git+https://github.com/xarleyn/dsh-plugins.git",
  directory: "plugins/dsh-fixture",
};
const CANONICAL_KEYWORDS = [
  "deepseek",
  "deepseek-harness",
  "dsh",
  "dsh-plugin",
  "cordis",
  "fixture",
];

function discoverableManifest(overrides = {}) {
  return {
    name: "@yadsh/dsh-fixture",
    version: "0.0.0",
    description: "Fixture plugin for DeepSeek Harness",
    keywords: [...CANONICAL_KEYWORDS],
    repository: { ...CANONICAL_REPOSITORY },
    homepage:
      "https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-fixture#readme",
    bugs: { url: "https://github.com/xarleyn/dsh-plugins/issues" },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    ...overrides,
  };
}

/**
 * Builds a `root/plugins/dsh-fixture` (and optionally `packages/*`) tree so the
 * discoverability checks can resolve a monorepo-relative directory.
 */
async function workspaceFixture({ plugins = {}, packages = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-catalog-"));
  for (const [group, entries] of [
    ["plugins", plugins],
    ["packages", packages],
  ]) {
    for (const [name, manifest] of Object.entries(entries)) {
      const directory = path.join(root, group, name);
      mkdirSync(directory, { recursive: true });
      writeJson(path.join(directory, "package.json"), manifest);
    }
  }
  return root;
}

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

/** Builds a `root/plugins/dsh-fixture` with a README the gate can scan. */
async function readmeFixture({ files, readme = "", name = "dsh-fixture" }) {
  const root = await workspaceFixture({
    plugins: { [name]: packageManifest(name, { files }) },
  });
  writeFileSync(path.join(root, "plugins", name, "README.md"), readme);
  return { root, directory: path.join(root, "plugins", name) };
}

function packageManifest(name, overrides = {}) {
  return {
    name: `@yadsh/${name}`,
    version: "1.2.3",
    description: `${name} for DeepSeek Harness`,
    keywords: [...CANONICAL_KEYWORDS],
    repository: {
      ...CANONICAL_REPOSITORY,
      directory: `plugins/${name}`,
    },
    homepage: `https://github.com/xarleyn/dsh-plugins/tree/main/plugins/${name}#readme`,
    bugs: { url: "https://github.com/xarleyn/dsh-plugins/issues" },
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    ...overrides,
  };
}

test("accepts a manifest that indexes and crawlers can attribute", async () => {
  const root = await workspaceFixture({
    plugins: { "dsh-fixture": discoverableManifest() },
  });
  try {
    assert.deepEqual(
      validateDiscoverability(path.join(root, "plugins", "dsh-fixture"), root),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a package no index can attribute to its sources", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-fixture": discoverableManifest({
        description: "A widget",
        keywords: ["deepseek-harness", "dsh", "deepseek", "dsh"],
        repository: {
          ...CANONICAL_REPOSITORY,
          directory: "somewhere/else",
        },
        homepage: "https://example.com/dsh-fixture",
        bugs: { url: "https://example.com/issues" },
      }),
    },
  });
  try {
    const errors = validateDiscoverability(
      path.join(root, "plugins", "dsh-fixture"),
      root,
    );
    assert.ok(
      errors.some((error) => error.includes('"dsh-plugin"')),
      `expected a missing dsh-plugin keyword, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes('"cordis"')),
      `expected a missing cordis keyword, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes("keywords must not repeat")),
      `expected a duplicate-keyword error, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes("repository.directory")),
      `expected a repository.directory error, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes("homepage must be")),
      `expected a homepage error, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes("bugs.url")),
      `expected a bugs.url error, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) => error.includes("description must name")),
      `expected a description error, got ${JSON.stringify(errors)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a repository that points somewhere else", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-fixture": discoverableManifest({
        repository: {
          type: "git",
          url: "https://example.com/elsewhere.git",
          directory: "plugins/dsh-fixture",
        },
      }),
    },
  });
  try {
    const errors = validateDiscoverability(
      path.join(root, "plugins", "dsh-fixture"),
      root,
    );
    assert.ok(
      errors.some((error) => error.includes("repository must be")),
      `expected a canonical-repository error, got ${JSON.stringify(errors)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalogs publishable packages and skips private ones", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-b": packageManifest("dsh-b", {
        dsh: { client: { platform: "web" } },
      }),
      "dsh-a": packageManifest("dsh-a"),
    },
    packages: {
      "plugin-private": packageManifest("dsh-private", { private: true }),
    },
  });
  try {
    const manifest = buildManifest(root);
    assert.deepEqual(
      manifest.plugins.map((entry) => entry.npm),
      ["@yadsh/dsh-a", "@yadsh/dsh-b"],
    );
    assert.deepEqual(manifest.plugins[0], {
      name: "dsh-a",
      npm: "@yadsh/dsh-a",
      path: "plugins/dsh-a",
      description: "dsh-a for DeepSeek Harness",
      keywords: CANONICAL_KEYWORDS,
      install: "dsh plugin --profile <profile> add @yadsh/dsh-a",
      homepage:
        "https://github.com/xarleyn/dsh-plugins/tree/main/plugins/dsh-a#readme",
      client: false,
    });
    assert.equal(manifest.plugins[1].client, true);
    assert.equal(manifest.repository, "https://github.com/xarleyn/dsh-plugins");
    assert.equal(manifest.githubTopic, "dsh-plugin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails while the catalog is missing or stale", async () => {
  const root = await workspaceFixture({
    plugins: { "dsh-a": packageManifest("dsh-a") },
  });
  const catalog = path.join(root, "plugins.json");
  try {
    assert.ok(
      findManifestDrift(root).some((error) =>
        error.includes("plugins.json is missing"),
      ),
    );

    writeFileSync(catalog, serializeManifest(buildManifest(root)));
    assert.deepEqual(findManifestDrift(root), []);

    // Reformatting the generated file is not drift.
    writeFileSync(catalog, JSON.stringify(buildManifest(root)));
    assert.deepEqual(findManifestDrift(root), []);

    // A keyword added to the package manifest must reach the catalog.
    writeJson(
      path.join(root, "plugins", "dsh-a", "package.json"),
      packageManifest("dsh-a", {
        keywords: [...CANONICAL_KEYWORDS, "extra-keyword"],
      }),
    );
    assert.ok(
      findManifestDrift(root).some((error) => error.includes("out of date")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails on a catalog entry for a package that no longer exists", async () => {
  const root = await workspaceFixture({
    plugins: { "dsh-a": packageManifest("dsh-a") },
  });
  try {
    const manifest = buildManifest(root);
    manifest.plugins.push({
      ...manifest.plugins[0],
      name: "dsh-removed",
      npm: "@yadsh/dsh-removed",
      path: "plugins/dsh-removed",
    });
    writeFileSync(path.join(root, "plugins.json"), serializeManifest(manifest));
    assert.ok(
      findManifestDrift(root).some((error) => error.includes("out of date")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes the runtime, the notices, and the README — not the docs", async () => {
  const { root, directory } = await readmeFixture({
    files: [
      "lib/**/*.js",
      "cordis.patch.yml",
      "compatibility.json",
      "capability-policy.json",
      "docs/images/*.png",
      "README.md",
      "NOTICE.md",
      "THIRD_PARTY_NOTICES.md",
      "LICENSE",
    ],
    readme: [
      "![card](docs/images/card.png)",
      "[compatibility](./compatibility.json)",
      "[MIT](LICENSE)",
    ].join("\n"),
  });
  try {
    assert.deepEqual(validatePublishedContent(directory, root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects documentation in the published file list", async () => {
  const { root, directory } = await readmeFixture({
    files: [
      "lib",
      "cordis.patch.yml",
      "compatibility.json",
      "README.md",
      "SPEC.md",
      "CHANGELOG.md",
      "ROADMAP.md",
      "docs/CONFIGURATION.md",
      "docs/sample-settings.yml",
      "LICENSE",
    ],
  });
  try {
    const errors = validatePublishedContent(directory, root);
    for (const entry of [
      "SPEC.md",
      "CHANGELOG.md",
      "ROADMAP.md",
      "docs/CONFIGURATION.md",
      "docs/sample-settings.yml",
    ]) {
      assert.ok(
        errors.some((error) => error.includes(`"${entry}"`)),
        `expected ${entry} to be rejected, got ${JSON.stringify(errors)}`,
      );
    }
    assert.equal(errors.length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a README link the package page cannot resolve", async () => {
  const { root, directory } = await readmeFixture({
    files: [
      "lib",
      "cordis.patch.yml",
      "compatibility.json",
      "README.md",
      "LICENSE",
    ],
    readme: [
      "[spec](./SPEC.md)",
      "[postmortem](../../docs/POSTMORTEM.md)",
      "[docs](docs/)",
      "[anchor](#install)",
      "[upstream](https://example.com/spec)",
    ].join("\n"),
  });
  try {
    const errors = validatePublishedContent(directory, root);
    assert.ok(
      errors.some((error) =>
        error.includes(
          'link to "https://github.com/xarleyn/dsh-plugins/blob/main/plugins/dsh-fixture/SPEC.md"',
        ),
      ),
      `expected an absolute SPEC.md suggestion, got ${JSON.stringify(errors)}`,
    );
    assert.ok(
      errors.some((error) =>
        error.includes(
          'link to "https://github.com/xarleyn/dsh-plugins/blob/main/docs/POSTMORTEM.md"',
        ),
      ),
      `expected an absolute repository-level suggestion, got ${JSON.stringify(errors)}`,
    );
    // Anchors, directory links, and absolute URLs are not the gate's business.
    assert.equal(errors.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// QA-surface changelog coverage: a qa-surface version plan demands a curated
// changelog entry for a version newer than the manifest's current version.
// ---------------------------------------------------------------------------

const qaSurfacePlan = [
  "---",
  '"@yadsh/dsh-qa-surface": patch',
  "---",
  "",
  "Fix the QA chat.",
  "",
].join("\n");

const changelogOf = (versions) =>
  `export const QA_CHANGELOG = [${versions
    .map(
      (version) =>
        `{ version: "${version}", date: "2026-09-16", sections: [] }`,
    )
    .join(",\n")}];\n`;

async function qaSurfaceFixture({
  plans = [],
  packages = {},
  version = "0.7.4",
  changelogVersions = ["0.7.4"],
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-qa-changelog-"));
  const plansRoot = path.join(root, ".nx", "version-plans");
  mkdirSync(plansRoot, { recursive: true });
  for (const [name, content] of plans) {
    writeFileSync(path.join(plansRoot, name), content);
  }
  for (const [name, manifest] of Object.entries(packages)) {
    const directory = path.join(root, "packages", name);
    mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, "package.json"), manifest);
  }
  const directory = path.join(root, "plugins", "dsh-qa-surface");
  mkdirSync(path.join(directory, "src", "client", "components"), {
    recursive: true,
  });
  writeJson(path.join(directory, "package.json"), {
    name: "@yadsh/dsh-qa-surface",
    version,
  });
  writeFileSync(
    path.join(directory, "src", "client", "components", "QaChangelog.tsx"),
    changelogOf(changelogVersions),
  );
  return root;
}

test("a qa-surface plan requires a changelog entry for the planned version", async () => {
  const root = await qaSurfaceFixture({ plans: [["plan.md", qaSurfacePlan]] });
  try {
    assert.throws(
      () => verifyVersionPlans(root),
      /plans bump to 0\.7\.5, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a qa-surface plan covered by the planned curated entry passes", async () => {
  const root = await qaSurfaceFixture({
    plans: [["plan.md", qaSurfacePlan]],
    changelogVersions: ["0.7.5", "0.7.4"],
  });
  try {
    assert.equal(verifyVersionPlans(root), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale future entry does not cover the next planned release", async () => {
  // The reviewer's false-positive: with 0.8.0 already recorded, a patch plan
  // still demands its own 0.7.5 entry — any-version-newer is not coverage.
  const root = await qaSurfaceFixture({
    plans: [["plan.md", qaSurfacePlan]],
    changelogVersions: ["0.8.0", "0.7.4"],
  });
  try {
    assert.throws(
      () => verifyVersionPlans(root),
      /plans bump to 0\.7\.5, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the highest qa-surface bump decides the demanded version", async () => {
  const minorPlan = [
    "---",
    '"@yadsh/dsh-qa-surface": minor',
    "---",
    "",
    "Add something to the QA chat.",
    "",
  ].join("\n");
  const matchingRoot = await qaSurfaceFixture({
    plans: [
      ["patch.md", qaSurfacePlan],
      ["minor.md", minorPlan],
    ],
    changelogVersions: ["0.8.0", "0.7.4"],
  });
  try {
    assert.equal(verifyVersionPlans(matchingRoot), 2);
  } finally {
    await rm(matchingRoot, { recursive: true, force: true });
  }

  const staleRoot = await qaSurfaceFixture({
    plans: [
      ["patch.md", qaSurfacePlan],
      ["minor.md", minorPlan],
    ],
    changelogVersions: ["0.7.5", "0.7.4"],
  });
  try {
    assert.throws(
      () => verifyVersionPlans(staleRoot),
      /plans bump to 0\.8\.0, but QaChangelog\.tsx has no entry for it/u,
    );
  } finally {
    await rm(staleRoot, { recursive: true, force: true });
  }
});

test("no qa-surface plan means no changelog demand", async () => {
  const root = await qaSurfaceFixture({
    plans: [
      [
        "plan.md",
        ["---", '"@yadsh/dsh-other": patch', "---", "", "Other work.", ""].join(
          "\n",
        ),
      ],
    ],
    packages: {
      "dsh-other": { name: "@yadsh/dsh-other", version: "1.0.0" },
    },
  });
  try {
    assert.equal(verifyVersionPlans(root), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an empty plan set never trips the changelog tripwire", async () => {
  const root = await qaSurfaceFixture();
  try {
    assert.equal(verifyVersionPlans(root), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changelog coverage parses front matter, versions, and orders them", () => {
  assert.deepEqual(planProjects(qaSurfacePlan), ["@yadsh/dsh-qa-surface"]);
  assert.deepEqual(planProjects("no front matter"), []);
  assert.equal(planBumpFor(qaSurfacePlan, "@yadsh/dsh-qa-surface"), "patch");
  assert.equal(planBumpFor(qaSurfacePlan, "@yadsh/dsh-other"), undefined);
  assert.equal(
    planBumpFor("no front matter", "@yadsh/dsh-qa-surface"),
    undefined,
  );
  assert.deepEqual(curatedChangelogVersions(changelogOf(["0.7.5", "0.7.4"])), [
    "0.7.5",
    "0.7.4",
  ]);
  assert.equal(incrementVersion("0.7.4", "patch"), "0.7.5");
  assert.equal(incrementVersion("0.7.4", "minor"), "0.8.0");
  assert.equal(incrementVersion("0.7.4", "major"), "1.0.0");
  assert.equal(incrementVersion("1.0.0-rc.1", "minor"), "1.1.0");
  assert.equal(incrementVersion("not-a-version", "patch"), undefined);
  assert.equal(compareVersions("0.7.5", "0.7.4"), 1);
  assert.equal(compareVersions("0.7.4", "0.7.4"), 0);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
});

// ---------------------------------------------------------------------------
// Client contract gates: a dsh.client manifest demands a package-name assert
// in the plugin's scripts, and a card source demands the card-contract gate.
// ---------------------------------------------------------------------------

const clientManifest = { dsh: { client: { platform: "web" } } };

async function pluginFixture({
  manifest = {},
  scriptFiles = {},
  sourceFiles = {},
}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-contract-"));
  const directory = path.join(root, "plugins", "dsh-fixture");
  mkdirSync(directory, { recursive: true });
  const fullManifest = {
    name: "@yadsh/dsh-fixture",
    version: "0.1.0",
    ...manifest,
  };
  writeJson(path.join(directory, "package.json"), fullManifest);
  for (const [name, content] of Object.entries(scriptFiles)) {
    const file = path.join(directory, "scripts", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  for (const [name, content] of Object.entries(sourceFiles)) {
    const file = path.join(directory, "src", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return { root, directory, manifest: fullManifest };
}

test("a client bundle whose scripts never assert the full package name fails", async () => {
  const { root, directory, manifest } = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": 'assert.equal(manifest.name, "dsh-fixture");\n',
    },
  });
  try {
    const errors = validateClientContractGates(directory, manifest);
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /asserts the ModuleLoader registration id "@yadsh\/dsh-fixture"/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a bare package-name mention without a ModuleLoader assert fails", async () => {
  // The reviewer's false-positive: `manifest.name === "@yadsh/dsh-fixture"`
  // mentions the full package name but pins no bundle registration id.
  const { root, directory, manifest } = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs":
        "assert.equal(manifest.name, '@yadsh/dsh-fixture');\n",
    },
  });
  try {
    const errors = validateClientContractGates(directory, manifest);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /ModuleLoader registration id/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("regex-literal and shared-runner asserts of the registration id both pass", async () => {
  const regexForm = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import assert from "node:assert/strict";',
        "",
        "assert.match(",
        "  client,",
        '  /window\\.__ModuleLoader__\\.load\\(\\{\\s*id:\\s*"@yadsh\\/dsh-fixture"/u,',
        ");",
        "",
      ].join("\n"),
    },
  });
  try {
    assert.deepEqual(
      validateClientContractGates(regexForm.directory, regexForm.manifest),
      [],
    );
  } finally {
    await rm(regexForm.root, { recursive: true, force: true });
  }

  const runnerForm = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { runVerifyPackage } from "@yadsh/dsh-plugin-scripts/run-verify-package";',
        "",
        "runVerifyPackage({",
        '  packageName: "@yadsh/dsh-fixture",',
        "  clientBundle: { moduleLoaderId: true },",
        "});",
        "",
      ].join("\n"),
    },
  });
  try {
    assert.deepEqual(
      validateClientContractGates(runnerForm.directory, runnerForm.manifest),
      [],
    );
  } finally {
    await rm(runnerForm.root, { recursive: true, force: true });
  }
});

test("a card source demands a script that runs the card-contract gate", async () => {
  const cardSource = {
    "client/card.tsx": 'renderSlot("settings.plugin.item", Card);\n',
  };
  const withoutGate = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
        "assert.equal(name, '@yadsh/dsh-fixture');",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    const errors = validateClientContractGates(
      withoutGate.directory,
      withoutGate.manifest,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /verify-plugin-card-contract/u);
  } finally {
    await rm(withoutGate.root, { recursive: true, force: true });
  }

  const withGate = await pluginFixture({
    manifest: clientManifest,
    scriptFiles: {
      "verify-package.mjs": [
        'import { verifyPluginCardContract } from "../../../scripts/verify-plugin-card-contract.mjs";',
        "",
        "verifyPluginCardContract(bundle);",
        "assert.match(client, /window\\.__ModuleLoader__\\.load/u);",
        "assert.equal(name, '@yadsh/dsh-fixture');",
        "",
      ].join("\n"),
    },
    sourceFiles: cardSource,
  });
  try {
    assert.deepEqual(
      validateClientContractGates(withGate.directory, withGate.manifest),
      [],
    );
  } finally {
    await rm(withGate.root, { recursive: true, force: true });
  }
});

test("a plugin without a client bundle or card owes neither gate", async () => {
  const { root, directory, manifest } = await pluginFixture({
    scriptFiles: { "verify-package.mjs": "assert.ok(true);\n" },
    sourceFiles: { "index.ts": "export const name = 'dsh-fixture';\n" },
  });
  try {
    assert.deepEqual(validateClientContractGates(directory, manifest), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
