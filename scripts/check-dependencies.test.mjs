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
import { mkdirSync, writeFileSync } from "node:fs";
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
 */
async function fixture({
  workspace = WORKSPACE_YAML,
  members = {},
  sources = {},
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-deps-boundary-"));
  if (workspace !== null)
    writeFile(path.join(root, "pnpm-workspace.yaml"), workspace);
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

function dshRuntime(version = "^0.1.5-rc.2") {
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

/** The compliant workspace the negative cases are derived from. */
function compliant(overrides = {}) {
  return {
    // A `null` workspace means "write no pnpm-workspace.yaml at all", so the
    // default is applied only when the case says nothing about it.
    workspace: "workspace" in overrides ? overrides.workspace : WORKSPACE_YAML,
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
