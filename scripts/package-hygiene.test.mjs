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
  validateDiscoverability,
  validatePublishedContent,
  validatePublishablePlugin,
  validateVersionPlan,
  validateWorkspaceScripts,
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
