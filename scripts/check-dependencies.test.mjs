#!/usr/bin/env node
/**
 * Boundary coverage for `scripts/check-dependencies.sh` (SPEC §27, issue #258).
 *
 * The gate is the only thing standing between this monorepo and a plugin
 * reaching into a sibling's `src/`, a shared package depending on a plugin, or
 * an undeclared import that pnpm's isolated linker happens to satisfy — and it
 * had no tests, so a regression in a rule was only ever found by a live
 * violator. These cases drive the checker over temporary workspace roots (the
 * `DSH_DEPS_ROOT` override it exposes for exactly this) and assert both
 * directions of every rule: the compliant fixture is clean, and each violation
 * is reported with the rule that names it.
 *
 * The rules live in `scripts/check-dependencies.mjs`, so the suite runs the
 * checker itself instead of re-importing it (it is a script, not a module).
 * The bash wrapper owns two bash-specific things — resolving the root and
 * running `pnpm dedupe --check` — and the last case drives it through
 * `run-bash.mjs`'s own bash discovery, so the wrapper is covered on Windows
 * and Linux alike.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { discoverBash } from "./run-bash.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = path.join(repoRoot, "scripts", "check-dependencies.mjs");
const wrapper = "scripts/check-dependencies.sh";

const WORKSPACE_YAML = [
  "packages:",
  '  - "packages/*"',
  '  - "plugins/*"',
  '  - "tooling/generators/*"',
  "nodeLinker: isolated",
  "disallowWorkspaceCycles: true",
  "",
].join("\n");

/**
 * The same workspace with named catalogs, which is all §27.12 reads out of
 * `pnpm-workspace.yaml`. `runtime` holds the one shared third-party range the
 * cases move in and out of it; `dsh`/`dsh-dev` mirror how this repository keeps
 * a peer range beside the exact version it pins for local builds.
 */
const WORKSPACE_WITH_CATALOGS = [
  "packages:",
  '  - "packages/*"',
  '  - "plugins/*"',
  '  - "tooling/generators/*"',
  "nodeLinker: isolated",
  "disallowWorkspaceCycles: true",
  "",
  "catalogs:",
  "  dsh:",
  "    '@deepseek-ai/dsh-llm': '^0.1.7-rc.2'",
  "  dsh-dev:",
  "    '@deepseek-ai/dsh-llm': '0.1.7-rc.2'",
  "  runtime:",
  "    zod: '^4.4.3'",
  "",
].join("\n");

function writeFile(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * One temporary workspace root. `members` and `sources` are keyed by
 * workspace-relative paths, so a case reads as the tree it describes.
 * `allowlist` is the §27.11 exception file, written when a case passes one.
 */
async function fixture({
  workspace = WORKSPACE_YAML,
  allowlist = null,
  members = {},
  sources = {},
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-deps-boundary-"));
  if (workspace !== null)
    writeFile(path.join(root, "pnpm-workspace.yaml"), workspace);
  if (allowlist !== null)
    writeJson(path.join(root, "plugin-dependency-allowlist.json"), allowlist);
  for (const [relative, manifest] of Object.entries(members)) {
    writeJson(path.join(root, relative, "package.json"), manifest);
  }
  for (const [relative, text] of Object.entries(sources)) {
    writeFile(path.join(root, relative), text);
  }
  return root;
}

async function withFixture(spec, body) {
  const root = await fixture(spec);
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Run the checker against one fixture and capture its verdict. */
function runChecker(root, { dedupe = "skipped" } = {}) {
  return spawnSync(process.execPath, [checker], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_DEPS_ROOT: root,
      DSH_DEPS_DEDUPE_STATUS: dedupe,
    },
  });
}

function dshRuntime(version = "^0.1.7-rc.2") {
  return { "@deepseek-ai/dsh-llm": version };
}

function sharedPackage(overrides = {}) {
  return {
    name: "@yadsh/dsh-shared",
    version: "0.0.0",
    exports: {
      ".": "./lib/index.js",
      "./extra": "./lib/extra.js",
    },
    ...overrides,
  };
}

function testKitPackage(overrides = {}) {
  return { name: "@yadsh/dsh-test-kit", version: "0.0.0", ...overrides };
}

/** A plugin that follows every rule: shared dep, DSH peers, test-kit dev-only. */
function pluginPackage(overrides = {}) {
  return {
    name: "@yadsh/dsh-one",
    version: "0.0.0",
    dependencies: { "@yadsh/dsh-shared": "workspace:*" },
    peerDependencies: dshRuntime(),
    devDependencies: { ...dshRuntime(), "@yadsh/dsh-test-kit": "workspace:*" },
    ...overrides,
  };
}

/**
 * The §27.12 compliant plugin: every range a catalog holds comes through that
 * catalog — the pinned dev copy included — while the peer keeps its literal
 * published range, which is the exemption the rule documents.
 */
function catalogedPluginPackage(overrides = {}) {
  return pluginPackage({
    dependencies: {
      "@yadsh/dsh-shared": "workspace:*",
      zod: "catalog:runtime",
    },
    devDependencies: {
      "@deepseek-ai/dsh-llm": "catalog:dsh-dev",
      "@yadsh/dsh-test-kit": "workspace:*",
    },
    ...overrides,
  });
}

/** The compliant workspace the negative cases are derived from. */
function compliant(overrides = {}) {
  return {
    // A `null` workspace means "write no pnpm-workspace.yaml at all", so the
    // default is applied only when the case says nothing about it.
    workspace: "workspace" in overrides ? overrides.workspace : WORKSPACE_YAML,
    allowlist: "allowlist" in overrides ? overrides.allowlist : null,
    members: {
      "packages/shared": sharedPackage(),
      "packages/test-kit": testKitPackage(),
      "plugins/one": pluginPackage(),
      ...overrides.members,
    },
    sources: {
      "plugins/one/src/local.ts": "export const local = 1;\n",
      "plugins/one/src/index.ts":
        'import { shared } from "@yadsh/dsh-shared";\n' +
        'import { extra } from "@yadsh/dsh-shared/extra";\n' +
        'import { local } from "./local.js";\n' +
        "export const one = [shared, extra, local];\n",
      ...overrides.sources,
    },
  };
}

/** A second plugin, for the cases about one plugin reaching for another. */
function otherPluginPackage(overrides = {}) {
  return {
    name: "@yadsh/dsh-two",
    version: "0.0.0",
    exports: { ".": "./lib/index.js" },
    ...overrides,
  };
}

/** The §27.11 file that lets `dsh-one` depend on `dsh-two`. */
function allowlistWith(...edges) {
  return {
    edges: edges.map(([from, to]) => ({
      from,
      to,
      reason: "dsh-two publishes the extension point dsh-one consumes.",
    })),
  };
}

test("a workspace that follows every rule is clean (§27.1)", async () => {
  await withFixture(compliant(), (root) => {
    const result = runChecker(root);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no dependency rule violations found/u);
    assert.match(result.stdout, /Summary: OK/u);
    // A plugin depending on a shared package is the allowed direction.
    assert.match(result.stdout, /@yadsh\/dsh-one \(plugins\/one\)/u);
  });
});

test("a shared package must not depend on a plugin (§27.2)", async () => {
  await withFixture(
    compliant({
      members: {
        "packages/shared": sharedPackage({
          dependencies: { "@yadsh/dsh-one": "workspace:*" },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.2\]/u);
      assert.match(
        result.stdout,
        /shared package '@yadsh\/dsh-shared' must not depend on plugin '@yadsh\/dsh-one' \(packages\/shared\/package\.json → dependencies/u,
      );
      assert.match(result.stdout, /Summary: FAILED/u);
    },
  );
});

test("an undeclared plugin→plugin dependency is caught (§27.11)", async () => {
  await withFixture(
    compliant({
      members: {
        "plugins/two": otherPluginPackage(),
        "plugins/one": pluginPackage({
          dependencies: {
            "@yadsh/dsh-shared": "workspace:*",
            "@yadsh/dsh-two": "workspace:*",
          },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.11\]/u);
      assert.match(
        result.stdout,
        /plugin '@yadsh\/dsh-one' depends on plugin '@yadsh\/dsh-two' \(plugins\/one\/package\.json → dependencies\.@yadsh\/dsh-two\), which plugin-dependency-allowlist\.json does not allow/u,
      );
      assert.match(
        result.stdout,
        /move the shared code to a packages\/\* member/u,
      );
    },
  );

  // A dependency field is a dependency field: a dev-only edge couples the
  // release cycles just the same and needs the same written-down reason.
  await withFixture(
    compliant({
      members: {
        "plugins/two": otherPluginPackage(),
        "plugins/one": pluginPackage({
          dependencies: { "@yadsh/dsh-shared": "workspace:*" },
          devDependencies: { "@yadsh/dsh-two": "workspace:*" },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /\[§27\.11\] plugin '@yadsh\/dsh-one' depends on plugin '@yadsh\/dsh-two' \(plugins\/one\/package\.json → devDependencies\./u,
      );
    },
  );
});

test("a plugin→plugin edge written down with a reason is allowed (§27.11)", async () => {
  await withFixture(
    compliant({
      allowlist: allowlistWith(["@yadsh/dsh-one", "@yadsh/dsh-two"]),
      members: {
        "plugins/two": otherPluginPackage(),
        "plugins/one": pluginPackage({
          dependencies: {
            "@yadsh/dsh-shared": "workspace:*",
            "@yadsh/dsh-two": "workspace:*",
          },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /no dependency rule violations found/u);
    },
  );
});

test("the allow-list is held to its own hygiene (§27.11)", async () => {
  await withFixture(
    compliant({
      allowlist: {
        edges: [
          { from: "@yadsh/dsh-one", to: "@yadsh/dsh-gone", reason: "kept" },
          { from: "@yadsh/dsh-one", to: "@yadsh/dsh-shared", reason: "kept" },
          { from: "@yadsh/dsh-one", to: "@yadsh/dsh-two" },
          { from: "@yadsh/dsh-one" },
        ],
      },
      members: { "plugins/two": otherPluginPackage() },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /edges\[0\] names '@yadsh\/dsh-gone', which is not a workspace member/u,
      );
      assert.match(
        result.stdout,
        /edges\[1\] names '@yadsh\/dsh-shared', which is packages\/shared and not a plugin/u,
      );
      assert.match(
        result.stdout,
        /edges\[2\] \(@yadsh\/dsh-one → @yadsh\/dsh-two\) has no 'reason'/u,
      );
      assert.match(result.stdout, /edges\[3\] must name both 'from' and 'to'/u);
    },
  );

  await withFixture(
    compliant({ allowlist: { edges: "not-an-array" } }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        /plugin-dependency-allowlist\.json: expected an "edges" array/u,
      );
    },
  );
});

/** Every `plugins/*` manifest of a real workspace root, keyed by package name. */
function shippedPluginManifests(root) {
  const manifests = new Map();
  for (const entry of readdirSync(path.join(root, "plugins"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, "plugins", entry.name, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    manifests.set(pkg.name, pkg);
  }
  return manifests;
}

test("the allow-list this repository ships matches its own manifests", () => {
  // Exception file and manifests are one fact, so they are compared in both
  // directions: an edge added without an entry, and an entry whose edge was
  // dropped, each fail here rather than in a live install.
  const manifests = shippedPluginManifests(repoRoot);
  const shipped = new Set();
  for (const pkg of manifests.values()) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (manifests.has(name) && name !== pkg.name) {
          shipped.add(`${pkg.name} → ${name}`);
        }
      }
    }
  }
  const allowed = new Set(
    JSON.parse(
      readFileSync(
        path.join(repoRoot, "plugin-dependency-allowlist.json"),
        "utf8",
      ),
    ).edges.map((edge) => `${edge.from} → ${edge.to}`),
  );
  assert.deepEqual(
    [...shipped].sort(),
    [...allowed].sort(),
    "plugin-dependency-allowlist.json must carry exactly the plugin→plugin edges this workspace ships",
  );
});

test("DSH runtime packages are peers, never dependencies (§27.3)", async () => {
  await withFixture(
    compliant({
      members: {
        "plugins/one": pluginPackage({
          dependencies: { "@yadsh/dsh-shared": "workspace:*", ...dshRuntime() },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.3\]/u);
      assert.match(
        result.stdout,
        /declares DSH runtime package '@deepseek-ai\/dsh-llm' in dependencies/u,
      );
      assert.match(
        result.stdout,
        /move '@deepseek-ai\/dsh-llm' to peerDependencies/u,
      );
    },
  );
});

test("test-kit is test-only (§27.4)", async () => {
  await withFixture(
    compliant({
      members: {
        "plugins/one": pluginPackage({
          dependencies: {
            "@yadsh/dsh-shared": "workspace:*",
            "@yadsh/dsh-test-kit": "workspace:*",
          },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.4\]/u);
      assert.match(
        result.stdout,
        /declares test-kit '@yadsh\/dsh-test-kit' in dependencies; test-kit is test-only/u,
      );
    },
  );
});

test("a cyclic workspace dependency is caught (§27.5)", async () => {
  await withFixture(
    compliant({
      members: {
        // Two plugins may depend on each other by name, which is exactly why
        // the gate needs the graph rather than a rule per manifest field.
        "plugins/one": pluginPackage({
          dependencies: { "@yadsh/dsh-two": "workspace:*" },
        }),
        "plugins/two": {
          name: "@yadsh/dsh-two",
          version: "0.0.0",
          exports: { ".": "./lib/index.js" },
          dependencies: { "@yadsh/dsh-one": "workspace:*" },
        },
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.5\]/u);
      assert.match(result.stdout, /cyclic workspace dependency detected/u);
      assert.match(result.stdout, /@yadsh\/dsh-one/u);
      assert.match(result.stdout, /@yadsh\/dsh-two/u);
      assert.match(result.stdout, /break the cycle/u);
    },
  );
});

test("pnpm-workspace.yaml must keep its two guards (§27.5, §27.7)", async () => {
  const guards = WORKSPACE_YAML.replace("nodeLinker: isolated\n", "");
  await withFixture(compliant({ workspace: guards }), (root) => {
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[§27\.7\]/u);
    assert.match(result.stdout, /must set 'nodeLinker: isolated'/u);
  });

  const cycles = WORKSPACE_YAML.replace("disallowWorkspaceCycles: true\n", "");
  await withFixture(compliant({ workspace: cycles }), (root) => {
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[§27\.5\]/u);
    assert.match(result.stdout, /must set 'disallowWorkspaceCycles: true'/u);
  });

  await withFixture(compliant({ workspace: null }), (root) => {
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[§27\.5\]/u);
    assert.match(result.stdout, /pnpm-workspace\.yaml not found at repo root/u);
  });
});

test("a range a catalog holds is declared through that catalog (§27.12)", async () => {
  await withFixture(
    compliant({
      workspace: WORKSPACE_WITH_CATALOGS,
      members: { "plugins/one": catalogedPluginPackage() },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 0);
      // The exempt peer is named as exempt, not simply missing from the report.
      assert.match(result.stdout, /peerDependencies stay literal on purpose/u);
      // Тот же литерал, что подставляет фикстура: bump каталога больше не
      // требует править это утверждение (оно пережило 0.1.5 → 0.1.7 само).
      const peerRange = dshRuntime()["@deepseek-ai/dsh-llm"].replace(
        /[.^]/gu,
        "\\$&",
      );
      assert.match(
        result.stdout,
        new RegExp(`@deepseek-ai/dsh-llm ${peerRange}`, "u"),
      );
    },
  );

  const reTyped = (field) =>
    withFixture(
      compliant({
        workspace: WORKSPACE_WITH_CATALOGS,
        members: {
          "plugins/one": catalogedPluginPackage(
            field === "dependencies"
              ? {
                  dependencies: {
                    "@yadsh/dsh-shared": "workspace:*",
                    zod: "^4.4.3",
                  },
                }
              : {
                  devDependencies: {
                    "@deepseek-ai/dsh-llm": "catalog:dsh-dev",
                    "@yadsh/dsh-test-kit": "workspace:*",
                    zod: "^4.4.3",
                  },
                },
          ),
        },
      }),
      (root) => {
        const result = runChecker(root);
        assert.equal(result.status, 1);
        assert.match(result.stdout, /\[§27\.12\]/u);
        assert.match(
          result.stdout,
          new RegExp(
            `declares 'zod' in ${field} as the literal range '\\^4\\.4\\.3' ` +
              "while catalog 'runtime' holds it",
            "u",
          ),
        );
        // The message explains the move rather than just forbidding the form:
        // packing expands the catalog, so nothing published changes.
        assert.match(result.stdout, /write "catalog:runtime"/u);
        assert.match(
          result.stdout,
          /packed, so the published manifest does not change/u,
        );
      },
    );

  await reTyped("dependencies");
  // A dependency field is a dependency field, dev copies of the range included.
  await reTyped("devDependencies");
});

test("literals no catalog covers are explained, not forbidden (§27.12)", async () => {
  await withFixture(
    compliant({
      workspace: WORKSPACE_WITH_CATALOGS,
      members: {
        "plugins/one": catalogedPluginPackage({
          dependencies: { "@yadsh/dsh-shared": "workspace:*", yaml: "^2.8.1" },
        }),
        "plugins/two": otherPluginPackage({
          dependencies: { yaml: "^2.9.0" },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      // Nothing here breaks a rule: yaml is in no catalog, so each manifest is
      // free to hold its own range. What the gate adds is that the two ranges
      // are now visible as one package resolving two ways.
      assert.equal(result.status, 0);
      assert.match(result.stdout, /advisory, §27\.12/u);
      assert.match(result.stdout, /yaml\s+\^2\.8\.1 \(1\) \| \^2\.9\.0 \(1\)/u);
      assert.match(result.stdout, /\^2\.8\.1 vs \^2\.9\.0/u);
      assert.match(result.stdout, /2 ranges to reconcile/u);
    },
  );

  // A range only one manifest needs is local by design, and says so.
  await withFixture(
    compliant({
      workspace: WORKSPACE_WITH_CATALOGS,
      members: {
        "plugins/one": catalogedPluginPackage({
          dependencies: {
            "@yadsh/dsh-shared": "workspace:*",
            chokidar: "^4.0.3",
          },
        }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 0);
      assert.match(
        result.stdout,
        /literal in a single manifest, local by design: chokidar/u,
      );
      assert.doesNotMatch(result.stdout, /ranges to reconcile/u);
    },
  );
});

test("the wrapper's pnpm dedupe verdict reaches the checker (§27.5)", async () => {
  await withFixture(compliant(), (root) => {
    const deduped = runChecker(root, { dedupe: "ok" });
    assert.equal(deduped.status, 0);

    const drift = runChecker(root, { dedupe: "fail" });
    assert.equal(drift.status, 1);
    assert.match(drift.stdout, /lockfile is not deduped/u);

    const cycles = runChecker(root, { dedupe: "fail-cycles" });
    assert.equal(cycles.status, 1);
    assert.match(cycles.stdout, /reported cyclic workspace dependencies/u);

    // The status is the wrapper's, so a value it never sets must not fail.
    const unknown = runChecker(root, { dedupe: "skipped" });
    assert.equal(unknown.status, 0);
  });
});

test("an import that no manifest declares is caught (§27.6)", async () => {
  await withFixture(
    compliant({
      members: {
        "plugins/one": pluginPackage({ dependencies: {} }),
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.6\]/u);
      assert.match(
        result.stdout,
        /plugins\/one\/src\/index\.ts: imports '@yadsh\/dsh-shared' but '@yadsh\/dsh-shared' is not declared/u,
      );
      assert.match(result.stdout, /do not rely on hoisting/u);
    },
  );
});

test("a deep import into another package's source is caught (§27.8)", async () => {
  await withFixture(
    compliant({
      sources: {
        "plugins/one/src/index.ts":
          'import { internal } from "@yadsh/dsh-shared/src/internals.js";\n' +
          "export const one = internal;\n",
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.8\]/u);
      assert.match(
        result.stdout,
        /deep import into another package's internal source/u,
      );
    },
  );
});

test("relative imports may not leave the package (§27.9)", async () => {
  await withFixture(
    compliant({
      members: {
        "plugins/two": {
          name: "@yadsh/dsh-two",
          version: "0.0.0",
          exports: { ".": "./lib/index.js" },
        },
      },
      sources: {
        "plugins/two/src/public.ts": "export const two = 2;\n",
        "plugins/one/src/index.ts":
          'import { two } from "../../two/src/public.js";\n' +
          "export const one = two;\n",
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.9\]/u);
      assert.match(
        result.stdout,
        /reaches into another package \('@yadsh\/dsh-two'/u,
      );
      assert.match(result.stdout, /depend on the package by name/u);
    },
  );

  await withFixture(
    compliant({
      sources: {
        "plugins/one/src/index.ts":
          'import { outside } from "../../../outside.js";\n' +
          "export const one = outside;\n",
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.9\]/u);
      assert.match(
        result.stdout,
        /escapes the package root of '@yadsh\/dsh-one'/u,
      );
    },
  );

  // The same package's own relative import stays legal — the compliant fixture
  // imports `./local.js` and is green in the first case.
});

test("a workspace package is entered through its exports map (§27.10)", async () => {
  await withFixture(
    compliant({
      sources: {
        "plugins/one/src/index.ts":
          'import { other } from "@yadsh/dsh-shared/other";\n' +
          "export const one = other;\n",
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.10\]/u);
      assert.match(result.stdout, /does not match any declared export/u);
      assert.match(result.stdout, /"\.\/extra"/u);
    },
  );

  await withFixture(
    compliant({
      members: {
        "packages/shared": sharedPackage({ exports: undefined }),
      },
      sources: {
        "plugins/one/src/index.ts":
          'import { extra } from "@yadsh/dsh-shared/extra";\n' +
          "export const one = extra;\n",
      },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[§27\.10\]/u);
      assert.match(result.stdout, /declares no "exports" map/u);
    },
  );
});

test("a manifest that cannot be read is reported instead of crashing", async () => {
  await withFixture(
    compliant({
      sources: { "plugins/broken/package.json": "{ not json\n" },
    }),
    (root) => {
      const result = runChecker(root);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\[manifest\]/u);
      assert.match(
        result.stdout,
        /plugins\/broken\/package\.json: invalid JSON/u,
      );
    },
  );
});

test("the bash wrapper resolves the root it is handed and propagates the verdict", async () => {
  await withFixture(
    compliant({
      members: {
        "packages/shared": sharedPackage({
          dependencies: { "@yadsh/dsh-one": "workspace:*" },
        }),
      },
    }),
    (root) => {
      // Through `run-bash.mjs`'s discovery, so the gate is driven the way
      // `pnpm deps:check` drives it on Windows and on Linux alike.
      const result = spawnSync(discoverBash(), [wrapper], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, DSH_DEPS_ROOT: root },
      });
      assert.equal(result.status, 1);
      assert.ok(
        result.stdout.includes(root.replaceAll("\\", "/")) ||
          result.stdout.includes(root),
        `the wrapper must name the root it was given:\n${result.stdout}`,
      );
      assert.match(result.stdout, /\[§27\.2\]/u);
      assert.match(result.stdout, /Summary: FAILED/u);
    },
  );
});
