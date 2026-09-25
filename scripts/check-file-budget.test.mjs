// check-file-budget.test.mjs — the budget gate, tested from both sides: a new
// file that breaks the rule has to fail the run, and the legacy files the
// allowlist carries must not. The second half matters as much as the first,
// because a gate that is red on the commit that introduces it never survives
// its own pull request. The report the CLI prints is tested too, since that
// text is the only thing a reader of a green run ever sees.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  auditFileBudget,
  budgets,
  checkFileBudget,
  countLines,
  fileBudgetAllowlist,
  main,
} from "./check-file-budget.mjs";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-file-budget-"));
  temporaryRoots.push(root);
  return root;
}

/** A file of exactly `lines` lines, so a test names a size, not a payload. */
function writeLines(root, relativePath, lines) {
  const file = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  const body = [];
  for (let index = 1; index <= lines; index += 1) body.push(`// ${index}`);
  writeFileSync(file, `${body.join("\n")}\n`, "utf8");
}

/** One exemption, so a test proves what an allowlist entry does. */
function exempt(...paths) {
  return paths.map((entry) =>
    typeof entry === "string" ? { path: entry, reason: "under test" } : entry,
  );
}

function run(root, allowlist = []) {
  return checkFileBudget(root, { allowlist });
}

/** Fails only because the gate says so, with the numbers a reader expects. */
function rejectsSize(promise, expected) {
  return assert.rejects(
    promise,
    (error) => {
      assert.match(error.message, /file budget failed/u);
      assert.ok(
        error.message.includes(expected),
        `expected the report to name ${expected}, got:\n${error.message}`,
      );
      return true;
    },
    `expected the run to fail with ${expected}`,
  );
}

/**
 * Run the CLI the way `pnpm check:files` does, and keep the text it printed:
 * a report line nobody asserts on is a report line that quietly disappears.
 */
async function runCli(root, { argv = [], ...options } = {}) {
  const lines = [];
  const writers = { log: console.log, error: console.error };
  console.log = console.error = (line) => lines.push(line);
  try {
    const code = await main(argv, root, options);
    return { code, output: lines.join("\n") };
  } finally {
    Object.assign(console, writers);
  }
}

test("the budgets are the numbers the repository rule states", () => {
  assert.deepEqual(budgets.source, { label: "source", warn: 1200, fail: 1400 });
  assert.deepEqual(budgets.test, { label: "test", warn: 700, fail: 900 });
  assert.ok(
    budgets.bundle.fail > budgets.source.fail * 10,
    "a generated bundle is measured against a runaway limit, not a source budget",
  );
});

test("a budget is a pair of line counts, with no room for a byte threshold", () => {
  for (const [kind, budget] of Object.entries(budgets)) {
    assert.deepEqual(
      Object.keys(budget).sort(),
      ["fail", "label", "warn"],
      `${kind}: a size goal in bytes is a different card, not an extra key here`,
    );
    for (const limit of [budget.warn, budget.fail]) {
      assert.ok(Number.isInteger(limit), `${kind}: budgets count lines`);
    }
  }
});

test("a line count is a line count, with or without the closing newline", () => {
  assert.equal(countLines("// a\n// b\n"), 2);
  assert.equal(countLines("// a\n// b"), 2);
  assert.equal(countLines(""), 0);
});

test("a new source file past the hard budget fails the run", async () => {
  const root = workspace();
  const file = "plugins/dsh-demo/src/index.ts";
  writeLines(root, file, budgets.source.fail);
  await run(root);
  writeLines(root, file, budgets.source.fail + 1);

  await rejectsSize(
    () => run(root),
    `${file}: ${budgets.source.fail + 1} lines (source budget ${budgets.source.fail})`,
  );
});

test("a warning-band source file costs a report line, not the run", async () => {
  const root = workspace();
  const file = "plugins/dsh-demo/src/index.ts";
  writeLines(root, file, budgets.source.warn);
  assert.deepEqual((await run(root)).warnings, []);

  writeLines(root, file, budgets.source.warn + 1);
  const report = await run(root);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(
    report.warnings.map((warning) => warning.path),
    [file],
  );
});

test("an allowlisted file never fails the run however much it grows", async () => {
  const root = workspace();
  const legacy = "plugins/dsh-qa-surface/src/types.ts";
  writeLines(root, legacy, budgets.source.fail + 1);

  assert.deepEqual((await run(root, exempt(legacy))).warnings, []);

  writeLines(root, legacy, budgets.source.fail * 4);
  const report = await run(root, exempt(legacy));
  assert.deepEqual(report.failures, []);
  assert.deepEqual(
    report.warnings,
    [],
    "growth inside the allowlist is not a warning",
  );
  assert.deepEqual(
    report.exempt.map((entry) => entry.path),
    [legacy],
  );
});

test("an allowlisted file is named with its reason, never reported as silent", async () => {
  const root = workspace();
  const legacy = "plugins/dsh-qa-surface/src/types.ts";
  writeLines(root, legacy, budgets.source.fail * 4);
  const reason = "legacy before the gate landed; owned by a refactor card";

  const { code, output } = await runCli(root, {
    allowlist: exempt({ path: legacy, reason }),
  });
  assert.equal(code, 0, "an exemption costs the run nothing");
  assert.ok(
    output.includes(`allowlisted: ${legacy} — ${reason}`),
    `expected the path and its reason on one line, got:\n${output}`,
  );
  assert.ok(
    output.includes(`${budgets.source.fail * 4} lines`),
    "the line carries the size that keeps the entry on the list",
  );
});

test("the CLI exit code is the verdict, in both directions", async () => {
  const root = workspace();
  const oversized = "plugins/dsh-demo/src/index.ts";
  writeLines(root, oversized, budgets.source.fail + 1);

  const failed = await runCli(root, { allowlist: [] });
  assert.equal(failed.code, 1);
  assert.ok(
    failed.output.includes(
      `${oversized}: ${budgets.source.fail + 1} lines (source budget ${budgets.source.fail})`,
    ),
    `expected the failure to name the file and its band, got:\n${failed.output}`,
  );

  rmSync(path.join(root, ...oversized.split("/")));
  const passed = await runCli(root, { allowlist: [] });
  assert.equal(passed.code, 0, "the same tree without the offender is green");
});

test("a test file is held to the tighter budget", async () => {
  const root = workspace();
  const file = "plugins/dsh-demo/tests/demo.test.ts";
  writeLines(root, file, budgets.test.fail + 1);
  await rejectsSize(
    () => run(root),
    `${file}: ${budgets.test.fail + 1} lines (test budget ${budgets.test.fail})`,
  );

  writeLines(root, file, budgets.test.warn + 1);
  const report = await run(root);
  assert.deepEqual(report.failures, []);
  assert.equal(report.warnings.length, 1);
});

test("a package script is source, so an oversized one fails the run", async () => {
  const root = workspace();
  const file = "plugins/dsh-demo/scripts/verify-package.mjs";
  writeLines(root, file, budgets.source.fail + 1);
  await rejectsSize(
    () => run(root),
    `${file}: ${budgets.source.fail + 1} lines (source budget ${budgets.source.fail})`,
  );
});

test("only the declared generated artifacts are measured under lib/", async () => {
  const root = workspace();
  const bundle = "plugins/dsh-demo/lib/client.js";
  writeLines(root, bundle, budgets.bundle.fail + 1);
  await rejectsSize(
    () => run(root),
    `${bundle}: ${budgets.bundle.fail + 1} lines (generated bundle budget ${budgets.bundle.fail})`,
  );

  // Both typert bridges are generated next to the client bundle by
  // packages/plugin-scripts/generate-typert.mjs, so a tree that swallowed a
  // dependency tree in either of them has to be caught the same way.
  for (const artifact of [
    "lib/typert.host.js",
    "lib/typert.remote-client.js",
  ]) {
    const generated = workspace();
    const file = `plugins/dsh-demo/${artifact}`;
    writeLines(generated, file, budgets.bundle.fail + 1);
    await rejectsSize(
      () => run(generated),
      `${file}: ${budgets.bundle.fail + 1} lines (generated bundle budget ${budgets.bundle.fail})`,
    );
  }

  const quiet = workspace();
  writeLines(
    quiet,
    "plugins/dsh-demo/lib/chunk-7q2f.js",
    budgets.bundle.fail + 1,
  );
  writeLines(quiet, "plugins/dsh-demo/src/index.ts", budgets.source.fail + 1);
  const report = await auditFileBudget(quiet, { allowlist: [] });
  assert.deepEqual(
    report.failures.map((failure) => failure.path),
    ["plugins/dsh-demo/src/index.ts"],
    "a compiled build artifact is derived output; the source it came from is what the gate reads",
  );
});

test("the report says out loud when the bundle band measured nothing", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", 12);

  const unbuilt = await runCli(root, { allowlist: [] });
  assert.equal(unbuilt.code, 0);
  assert.match(
    unbuilt.output,
    /0 generated artifacts/u,
    "a checkout with no build output — CI's prepare job — must not read as a passing bundle budget",
  );

  writeLines(root, "plugins/dsh-demo/lib/client.js", 120);
  const built = await runCli(root, { allowlist: [] });
  assert.equal(built.code, 0);
  assert.ok(
    !/0 generated artifacts/u.test(built.output),
    `expected the count to report the artifact that exists, got:\n${built.output}`,
  );
  assert.match(built.output, /\(1 generated/u);
});

test("an exemption without a reason is refused, not reviewed later", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", 12);

  for (const reason of [undefined, "", "   "]) {
    await assert.rejects(
      () => run(root, [{ path: "plugins/dsh-demo/src/whatever.ts", reason }]),
      /has no reason for the exemption/u,
      `a ${JSON.stringify(reason)} reason must not open the gate`,
    );
  }

  await assert.rejects(
    () => run(root, ["plugins/dsh-demo/src/index.ts"]),
    /allowlist entry without a path/u,
    "a bare path is the shape a budget list decays into",
  );
});

test("an allowlist entry whose file is gone fails the run", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", 12);

  await rejectsSize(
    () => run(root, exempt("plugins/dsh-demo/src/removed.ts")),
    "allowlisted file does not exist, drop it from fileBudgetAllowlist",
  );
});

test("an allowlist entry that came back within budget is reported, not failed", async () => {
  const root = workspace();
  const legacy = "plugins/dsh-demo/src/index.ts";
  writeLines(root, legacy, 40);

  const report = await run(root, exempt(legacy));
  assert.deepEqual(report.failures, []);
  assert.match(report.warnings[0].reason, /drop it from fileBudgetAllowlist/u);
});

test("the committed allowlist carries a reason per entry and no dead path", () => {
  const paths = new Set();
  for (const entry of fileBudgetAllowlist) {
    assert.ok(typeof entry.reason === "string" && entry.reason.trim() !== "");
    assert.ok(!paths.has(entry.path), `${entry.path} is listed twice`);
    paths.add(entry.path);
    assert.match(entry.path, /^(plugins|packages)\//u);
  }
});

test("the workspace itself passes the committed allowlist", async () => {
  const report = await checkFileBudget();
  assert.ok(
    report.measured.length > 1000,
    `the gate measured ${report.measured.length} files; it is not reading the workspace`,
  );
  assert.equal(
    report.exempt.length,
    fileBudgetAllowlist.length,
    "every allowlist entry must be a file that still exists and is still over budget",
  );
  assert.deepEqual(
    report.exempt.filter((entry) => entry.kind === "test"),
    [],
    "no test file needs an exemption at the test budget, so none is allowed to",
  );
  assert.deepEqual(
    report.warnings.filter((warning) =>
      /drop it from fileBudgetAllowlist/u.test(warning.reason),
    ),
    [],
    "an exemption whose file is back within budget leaves the list in the same change",
  );
});

test("the printed report names every committed exemption and its reason", async () => {
  const { code, output } = await runCli(workspaceRoot);
  assert.equal(code, 0, "the workspace must be green with the committed list");
  for (const entry of fileBudgetAllowlist) {
    assert.ok(
      output.includes(`allowlisted: ${entry.path} — ${entry.reason}`),
      `${entry.path} is on the list but the run never says so`,
    );
  }
});
