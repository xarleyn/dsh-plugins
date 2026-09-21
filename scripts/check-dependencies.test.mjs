// check-dependencies.test.mjs — offline coverage for the SPEC §27 dependency
// boundary gate (scripts/check-dependencies.mjs, run by `pnpm deps:check`).
//
// The contract, one line per rule (check-dependencies.mjs is the source of
// truth; the wrapper's header repeats this list for the shell entry point):
//
//   rule     who -> whom                                        verdict
//   §27.1    plugin -> shared package (packages/*)               allowed
//   §27.2    shared package -> plugin                            rejected
//   §27.3    @deepseek-ai/* in dependencies                      rejected (peer only)
//   §27.4    test-kit outside devDependencies                    rejected
//   §27.5    workspace member -> member cycle                    rejected
//   §27.6    import -> package missing from the own manifest     rejected
//   §27.7    undeclared import satisfied by hoisting             rejected (isolated linker)
//   §27.8    import -> another package's /src path               rejected
//   §27.9    relative import -> outside the own package          rejected
//   §27.10   import -> subpath missing from the exports map      rejected
//   manifest manifest -> a scoped name that is no member          rejected
//
// The gate is a top-level script, so this suite drives it the way the bash
// wrapper does: as a subprocess with DSH_DEPS_ROOT pointed at a throwaway
// workspace whose manifests and sources are written per rule. Every rule is
// exercised in both directions — the allowed shape passes, the violation is
// reported under its own rule tag — because a boundary gate that is only ever
// run against the real tree is covered by luck rather than by tests.
//
// The bash wrapper itself is not invoked from here: its only contract is the
// DSH_DEPS_DEDUPE_STATUS it exports for the checker, which the tests below set
// directly (exactly as the wrapper does), while running it would shell out to
// `pnpm dedupe` against a fixture that has no lockfile. `pnpm deps:check` runs
// the wrapper against the real tree in CI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(
  new URL("./check-dependencies.mjs", import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const WORKSPACE_YAML = [
  "packages:",
  "  - packages/*",
  "  - plugins/*",
  "nodeLinker: isolated",
  "disallowWorkspaceCycles: true",
  "",
].join("\n");

const KIT_EXPORTS = {
  ".": "./lib/index.js",
  "./tools": "./lib/tools.js",
  "./package.json": "./package.json",
};

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function manifest(name, extra = {}) {
  return json({ name, version: "0.0.0", ...extra });
}

function alpha(extra = {}) {
  return manifest("@yadsh/dsh-alpha", {
    exports: { ".": "./lib/index.js" },
    dependencies: { "@yadsh/kit": "workspace:^" },
    ...extra,
  });
}

/**
 * A workspace that satisfies every rule, so each test changes exactly one
 * thing: one shared package, one plugin that reaches it through the package
 * name and one declared subpath, and the workspace guards pnpm needs. `null`
 * omits a file the base writes.
 */
function fixture(overrides = {}) {
  return {
    "pnpm-workspace.yaml": WORKSPACE_YAML,
    "packages/kit/package.json": manifest("@yadsh/kit", {
      exports: KIT_EXPORTS,
    }),
    "packages/kit/src/index.ts": "export const kit = 1;\n",
    "packages/test-kit/package.json": manifest("@yadsh/dsh-test-kit"),
    "plugins/alpha/package.json": alpha(),
    // §27.1 (a plugin may depend on a shared package) and an in-package
    // relative import, both of which have to stay legal.
    "plugins/alpha/src/index.ts":
      'import { kit } from "@yadsh/kit";\n' +
      'import { helper } from "./helper.js";\n' +
      "export const alpha = kit + helper;\n",
    "plugins/alpha/src/helper.ts": "export const helper = 1;\n",
    ...overrides,
  };
}

/** Run the gate at `root`; `DSH_DEPS_DEDUPE_STATUS` defaults to the wrapper's "skipped". */
function runChecker(root, env = {}) {
  const result = spawnSync(process.execPath, [CHECKER], {
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_DEPS_ROOT: root,
      DSH_DEPS_DEDUPE_STATUS: "skipped",
      ...env,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Write a fixture to a temporary directory and run the gate against it. */
function runFixture(files, env = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-deps-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      if (content === null) continue;
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return runChecker(root, env);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertAccepted(result) {
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /✓ no dependency rule violations found/);
}

function assertRejected(result, rule, fragment) {
  assert.equal(result.status, 1, `expected a violation:\n${result.output}`);
  assert.ok(
    result.output.includes(`[${rule}]`),
    `expected a ${rule} violation:\n${result.output}`,
  );
  assert.match(result.output, fragment, result.output);
  assert.match(result.output, /Summary: FAILED — see SPEC §27/, result.output);
}

// ---------------------------------------------------------------------------
// Accepted shapes
// ---------------------------------------------------------------------------

test("accepts a workspace that satisfies every rule", () => {
  assertAccepted(runFixture(fixture()));
});

test("accepts a DSH runtime package as a peer with a dev copy for tests", () => {
  assertAccepted(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          peerDependencies: { "@deepseek-ai/dsh-tools": "catalog:dsh" },
          devDependencies: { "@deepseek-ai/dsh-tools": "catalog:dsh-dev" },
        }),
      }),
    ),
  );
});

test("accepts test-kit as a devDependency", () => {
  assertAccepted(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          devDependencies: { "@yadsh/dsh-test-kit": "workspace:^" },
        }),
      }),
    ),
  );
});

test("accepts a subpath the target declares in its exports", () => {
  assertAccepted(
    runFixture(
      fixture({
        "plugins/alpha/src/index.ts":
          'import { tools } from "@yadsh/kit/tools";\nexport const alpha = tools;\n',
      }),
    ),
  );
});

test("accepts the repository tree", () => {
  assertAccepted(runChecker(REPO_ROOT));
});

// ---------------------------------------------------------------------------
// §27.2 — shared packages must not depend on plugins
// ---------------------------------------------------------------------------

test("rejects a shared package that depends on a plugin", () => {
  assertRejected(
    runFixture(
      fixture({
        "packages/kit/package.json": manifest("@yadsh/kit", {
          exports: KIT_EXPORTS,
          dependencies: { "@yadsh/dsh-alpha": "workspace:^" },
        }),
      }),
    ),
    "§27.2",
    /shared package '@yadsh\/kit' must not depend on plugin/,
  );
});

// ---------------------------------------------------------------------------
// §27.3 — DSH runtime packages are peers
// ---------------------------------------------------------------------------

test("rejects a DSH runtime package declared as a dependency", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          dependencies: {
            "@yadsh/kit": "workspace:^",
            "@deepseek-ai/dsh-tools": "catalog:dsh",
          },
        }),
      }),
    ),
    "§27.3",
    /must be peerDependencies/,
  );
});

// ---------------------------------------------------------------------------
// §27.4 — test-kit is test-only
// ---------------------------------------------------------------------------

test("rejects test-kit outside devDependencies", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          dependencies: {
            "@yadsh/kit": "workspace:^",
            "@yadsh/dsh-test-kit": "workspace:^",
          },
        }),
      }),
    ),
    "§27.4",
    /test-kit is\s+test-only and may only appear in devDependencies/,
  );
});

// ---------------------------------------------------------------------------
// §27.5 — cycles and the workspace guards that reject them
// ---------------------------------------------------------------------------

test("rejects a cyclic workspace dependency", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          dependencies: {
            "@yadsh/kit": "workspace:^",
            "@yadsh/dsh-beta": "workspace:^",
          },
        }),
        "plugins/beta/package.json": manifest("@yadsh/dsh-beta", {
          exports: { ".": "./lib/index.js" },
          dependencies: { "@yadsh/dsh-alpha": "workspace:^" },
        }),
        "plugins/beta/src/index.ts":
          'import { alpha } from "@yadsh/dsh-alpha";\nexport const beta = alpha;\n',
      }),
    ),
    "§27.5",
    /cyclic workspace dependency detected: .* -> .* -> /,
  );
});

test("rejects a workspace that drops the workspace-cycle guard", () => {
  assertRejected(
    runFixture(
      fixture({
        "pnpm-workspace.yaml": "nodeLinker: isolated\n",
      }),
    ),
    "§27.5",
    /must set 'disallowWorkspaceCycles: true'/,
  );
});

test("rejects a workspace without pnpm-workspace.yaml", () => {
  assertRejected(
    runFixture(fixture({ "pnpm-workspace.yaml": null })),
    "§27.5",
    /pnpm-workspace.yaml not found at repo root/,
  );
});

test("reports a dedupe run the wrapper rejected for cycles", () => {
  assertRejected(
    runFixture(fixture(), { DSH_DEPS_DEDUPE_STATUS: "fail-cycles" }),
    "§27.5",
    /reported cyclic workspace dependencies/,
  );
});

test("reports a dedupe run the wrapper found not deduped", () => {
  assertRejected(
    runFixture(fixture(), { DSH_DEPS_DEDUPE_STATUS: "fail" }),
    "§27.5",
    /lockfile is not deduped/,
  );
});

// ---------------------------------------------------------------------------
// §27.7 — hoisting must not satisfy undeclared dependencies
// ---------------------------------------------------------------------------

test("rejects a workspace that drops the isolated node linker", () => {
  assertRejected(
    runFixture(
      fixture({
        "pnpm-workspace.yaml": "disallowWorkspaceCycles: true\n",
      }),
    ),
    "§27.7",
    /must set 'nodeLinker: isolated'/,
  );
});

// ---------------------------------------------------------------------------
// §27.6 — every import is declared in the importing manifest
// ---------------------------------------------------------------------------

test("rejects an import no manifest declares", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/package.json": manifest("@yadsh/dsh-alpha", {
          exports: { ".": "./lib/index.js" },
        }),
      }),
    ),
    "§27.6",
    /is not declared in .*package\.json/,
  );
});

// ---------------------------------------------------------------------------
// §27.8 — no deep imports into another package's source
// ---------------------------------------------------------------------------

test("rejects a deep import into another package's src", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/src/index.ts":
          'import { kit } from "@yadsh/kit/src/index.js";\nexport const alpha = kit;\n',
      }),
    ),
    "§27.8",
    /deep import into another package's/,
  );
});

// ---------------------------------------------------------------------------
// §27.9 — relative imports stay inside their own package
// ---------------------------------------------------------------------------

test("rejects a relative import that reaches into another package", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/src/index.ts":
          'import { kit } from "../../../packages/kit/src/index.js";\nexport const alpha = kit;\n',
      }),
    ),
    "§27.9",
    /reaches into another package/,
  );
});

test("rejects a relative import that escapes the package root", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/src/index.ts":
          'import { shared } from "../../outside.js";\nexport const alpha = shared;\n',
      }),
    ),
    "§27.9",
    /escapes the package root/,
  );
});

// ---------------------------------------------------------------------------
// §27.10 — workspace packages are consumed through their declared exports
// ---------------------------------------------------------------------------

test("rejects a subpath the target does not export", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/src/index.ts":
          'import { nope } from "@yadsh/kit/nope";\nexport const alpha = nope;\n',
      }),
    ),
    "§27.10",
    /does not match any declared export/,
  );
});

test("rejects a subpath import of a package without an exports map", () => {
  assertRejected(
    runFixture(
      fixture({
        "packages/kit/package.json": manifest("@yadsh/kit"),
        "plugins/alpha/src/index.ts":
          'import { nope } from "@yadsh/kit/nope";\nexport const alpha = nope;\n',
      }),
    ),
    "§27.10",
    /declares no "exports" map/,
  );
});

// ---------------------------------------------------------------------------
// Manifest-level rules
// ---------------------------------------------------------------------------

test("rejects a dependency that names no workspace package", () => {
  assertRejected(
    runFixture(
      fixture({
        "plugins/alpha/package.json": alpha({
          dependencies: {
            "@yadsh/kit": "workspace:^",
            "@yadsh/dsh-ghost": "workspace:^",
          },
        }),
      }),
    ),
    "manifest",
    /no such workspace\s+package exists/,
  );
});

test("rejects a manifest that is not valid JSON", () => {
  assertRejected(
    runFixture(fixture({ "plugins/alpha/package.json": "{ not json\n" })),
    "manifest",
    /invalid JSON/,
  );
});
