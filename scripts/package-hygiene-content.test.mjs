import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  writeJson,
  workspaceFixture,
} from "./test-support/package-hygiene-fixtures.mjs";
import {
  buildManifest,
  findManifestDrift,
  serializeManifest,
} from "./generate-plugins-manifest.mjs";
import {
  findReadmeCatalogGaps,
  globToRegExp,
  isPublishedFile,
  validateDiscoverability,
  validatePublishedContent,
} from "./verify-package-hygiene.mjs";

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

test("matches `**/` across any depth of directories", () => {
  // A chained replace once rewrote the `*` inside the group it had just
  // inserted, so the pattern covered a single directory at most and a nested
  // CHANGELOG.md slipped past the release-plan gate.
  assert.equal(globToRegExp("**/CHANGELOG.md").test("CHANGELOG.md"), true);
  assert.equal(
    globToRegExp("**/CHANGELOG.md").test(
      "plugins/dsh-web-fetch-authenticated/CHANGELOG.md",
    ),
    true,
  );
  assert.equal(globToRegExp("lib/**/*.js").test("lib/a.js"), true);
  assert.equal(
    globToRegExp("lib/**/*.js").test("lib/providers/jira/x.js"),
    true,
  );
  assert.equal(globToRegExp("lib/*.js").test("lib/a/b.js"), false);
});

test("publishes a deeply nested file through a `**` entry", () => {
  assert.equal(isPublishedFile(["**/*.md"], "docs/specs/deep/note.md"), true);
  assert.equal(isPublishedFile(["lib/*.js"], "lib/deep/x.js"), false);
});

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
        dsh: {
          bundle: { patch: "./cordis.patch.yml" },
          client: { platform: "web" },
        },
      }),
      "dsh-a": packageManifest("dsh-a", {
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
      }),
    },
    packages: {
      "plugin-kit": packageManifest("dsh-plugin-kit", {
        repository: {
          ...CANONICAL_REPOSITORY,
          directory: "packages/plugin-kit",
        },
        homepage:
          "https://github.com/xarleyn/dsh-plugins/tree/main/packages/plugin-kit#readme",
      }),
      "plugin-private": packageManifest("dsh-private", { private: true }),
    },
  });
  try {
    const manifest = buildManifest(root);
    assert.deepEqual(
      manifest.plugins.map((entry) => entry.npm),
      ["@yadsh/dsh-plugin-kit", "@yadsh/dsh-a", "@yadsh/dsh-b"],
    );
    assert.deepEqual(manifest.plugins[0], {
      name: "plugin-kit",
      npm: "@yadsh/dsh-plugin-kit",
      path: "packages/plugin-kit",
      description: "dsh-plugin-kit for DeepSeek Harness",
      keywords: CANONICAL_KEYWORDS,
      kind: "library",
      install: "pnpm add @yadsh/dsh-plugin-kit",
      homepage:
        "https://github.com/xarleyn/dsh-plugins/tree/main/packages/plugin-kit#readme",
      client: false,
    });
    assert.equal(manifest.plugins[1].kind, "plugin");
    assert.equal(
      manifest.plugins[1].install,
      "dsh plugin --profile <profile> add @yadsh/dsh-a",
    );
    assert.equal(manifest.plugins[2].kind, "plugin");
    assert.equal(manifest.plugins[2].client, true);
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

test("keeps the root README table listing every publishable package", async () => {
  const root = await workspaceFixture({
    plugins: {
      "dsh-a": packageManifest("dsh-a", {
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
      }),
    },
    packages: { "dsh-plugin-kit": packageManifest("dsh-plugin-kit") },
  });
  try {
    assert.ok(
      findReadmeCatalogGaps(root).some((error) =>
        error.includes("README.md is missing"),
      ),
    );

    // A row for one package leaves the other unlisted: a package absent from
    // the table is invisible to a reader who never opens plugins.json.
    writeFileSync(
      path.join(root, "README.md"),
      "| Directory | npm package | Kind | Purpose |\n" +
        "| --- | --- | --- | --- |\n" +
        "| `plugins/dsh-a` | `@yadsh/dsh-a` | DSH plugin | a |\n",
    );
    assert.deepEqual(findReadmeCatalogGaps(root), [
      "@yadsh/dsh-plugin-kit is missing from the root README package table (packages/dsh-plugin-kit)",
    ]);

    // A published package mislabelled "private" leaves its npm name out of the
    // table just as effectively, so the gate keys on the npm name.
    writeFileSync(
      path.join(root, "README.md"),
      "| Directory | npm package | Kind | Purpose |\n" +
        "| --- | --- | --- | --- |\n" +
        "| `plugins/dsh-a` | `@yadsh/dsh-a` | DSH plugin | a |\n" +
        "| `packages/dsh-plugin-kit` | private workspace package | not published | kit |\n",
    );
    assert.equal(findReadmeCatalogGaps(root).length, 1);

    writeFileSync(
      path.join(root, "README.md"),
      "| Directory | npm package | Kind | Purpose |\n" +
        "| --- | --- | --- | --- |\n" +
        "| `plugins/dsh-a` | `@yadsh/dsh-a` | DSH plugin | a |\n" +
        "| `packages/dsh-plugin-kit` | `@yadsh/dsh-plugin-kit` | runtime library | kit |\n",
    );
    assert.deepEqual(findReadmeCatalogGaps(root), []);
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
