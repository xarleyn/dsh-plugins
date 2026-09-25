// check-file-budget.test.mjs — the budget gate, tested from both sides: a new
// file that breaks the rule has to fail the run, and the legacy files the
// allowlist carries must not. The second half matters as much as the first,
// because a gate that is red on the commit that introduces it never survives
// its own pull request.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  auditFileBudget,
  budgets,
  checkFileBudget,
  countLines,
  legacyOverBudget,
} from "./check-file-budget.mjs";

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

function run(root, allowlist = new Set()) {
  return checkFileBudget(root, { allowlist });
}

test("the budgets are the numbers the repository rule states", () => {
  assert.deepEqual(budgets.source, { label: "source", warn: 800, fail: 1200 });
  assert.deepEqual(budgets.test, { label: "test", warn: 400, fail: 800 });
  assert.ok(
    budgets.bundle.fail > budgets.source.fail * 10,
    "a generated bundle is measured against a runaway limit, not a source budget",
  );
});

test("a line count is a line count, with or without the closing newline", () => {
  assert.equal(countLines("// a\n// b\n"), 2);
  assert.equal(countLines("// a\n// b"), 2);
  assert.equal(countLines(""), 0);
});

test("a new source file past the hard budget fails the run", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", budgets.source.fail);
  await run(root);
  writeLines(root, "plugins/dsh-demo/src/index.ts", budgets.source.fail + 1);

  await assert.rejects(
    () => run(root),
    /plugins\/dsh-demo\/src\/index\.ts: 1201 lines \(source budget 1200\)/u,
  );
});

test("a warning-band source file costs a report line, not the run", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", budgets.source.warn + 1);
  const report = await run(root);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(
    report.warnings.map((warning) => warning.path),
    ["plugins/dsh-demo/src/index.ts"],
  );
});

test("an allowlisted legacy file stays silent however large it grows", async () => {
  const root = workspace();
  const legacy = "plugins/dsh-qa-surface/src/types.ts";
  writeLines(root, legacy, budgets.source.fail * 4);

  const report = await run(root, new Set([legacy]));
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(
    report.exempt.map((entry) => entry.path),
    [legacy],
  );
});

test("a test file is held to the tighter budget", async () => {
  const root = workspace();
  writeLines(
    root,
    "plugins/dsh-demo/tests/demo.test.ts",
    budgets.test.fail + 1,
  );
  await assert.rejects(
    () => run(root),
    /plugins\/dsh-demo\/tests\/demo\.test\.ts: 801 lines \(test budget 800\)/u,
  );

  writeLines(
    root,
    "plugins/dsh-demo/tests/demo.test.ts",
    budgets.test.warn + 1,
  );
  const report = await run(root);
  assert.deepEqual(report.failures, []);
  assert.equal(report.warnings.length, 1);
});

test("only the declared generated artifacts are measured under lib/", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/lib/client.js", budgets.bundle.fail + 1);
  await assert.rejects(
    () => run(root),
    /plugins\/dsh-demo\/lib\/client\.js: 100001 lines \(generated bundle budget 100000\)/u,
  );

  const quiet = workspace();
  writeLines(
    quiet,
    "plugins/dsh-demo/lib/chunk-7q2f.js",
    budgets.bundle.fail + 1,
  );
  writeLines(quiet, "plugins/dsh-demo/src/index.ts", budgets.source.fail + 1);
  const report = await auditFileBudget(quiet, { allowlist: new Set() });
  assert.deepEqual(
    report.failures.map((failure) => failure.path),
    ["plugins/dsh-demo/src/index.ts"],
    "a compiled build artifact is derived output; the source it came from is what the gate reads",
  );
});

test("an allowlist entry whose file is gone fails the run", async () => {
  const root = workspace();
  writeLines(root, "plugins/dsh-demo/src/index.ts", 12);

  await assert.rejects(
    () => run(root, new Set(["plugins/dsh-demo/src/removed.ts"])),
    /allowlisted file does not exist, drop it from legacyOverBudget/u,
  );
});

test("an allowlist entry that came back within budget is reported, not failed", async () => {
  const root = workspace();
  const legacy = "plugins/dsh-demo/src/index.ts";
  writeLines(root, legacy, 40);

  const report = await run(root, new Set([legacy]));
  assert.deepEqual(report.failures, []);
  assert.match(report.warnings[0].reason, /drop it from legacyOverBudget/u);
});

test("the workspace itself passes the committed allowlist", async () => {
  const report = await checkFileBudget();
  assert.ok(
    report.measured.length > 1000,
    `the gate measured ${report.measured.length} files; it is not reading the workspace`,
  );
  assert.equal(
    report.exempt.length,
    legacyOverBudget.size,
    "every allowlist entry must be a file that still exists and is still over budget",
  );
});
