/**
 * File size budget.
 *
 * A file that nobody measures grows on its own: the qa-surface type module
 * passed 2000 lines one commit at a time, and each commit was small enough to
 * review on its own. Line count is a weak proxy for complexity, but it is the
 * only proxy that costs nothing to check, and it is the number that decides
 * whether a reader can hold a module in their head at all.
 *
 * So the budget is deliberately blunt, and deliberately split by what a file
 * is for:
 *
 * - a source file gets 1400 lines before the run fails, and a warning from 1200
 *   on — the band the repository already sits in, so the warning names work
 *   worth splitting without rejecting what the gate inherited;
 * - a test file gets a tighter budget (900, warning from 700), because a test
 *   reads top to bottom as a list of cases and a long list is a missing helper
 *   or a missing second file (`0 test files over 400 lines` was an audit's own
 *   claim, and it went stale within a week);
 * - a generated browser bundle gets a runaway limit and nothing else. It is
 *   derived, so its size is a symptom of what the source budget already
 *   measures; the only thing worth failing on is a bundle that swallowed a
 *   dependency tree it was supposed to import. Both bands are line counts —
 *   bytes are a different measurement and a different card.
 *
 * Files already over their hard budget are listed in `fileBudgetAllowlist`, and
 * the gate exists to stop the next 400 lines, not to re-litigate the last 2000:
 * a check that is red on the day it lands is a check that gets switched off.
 * Growing an allowlisted file is neither an error nor a warning — the refactor
 * cards own those paths, not the gate. What the run does print is one
 * `allowlisted: <path> — <reason>` line per entry, because an exemption nobody
 * sees eventually reads like coverage. An entry leaves the list when its file is
 * split or deleted, and every entry states the reason it is exempt on its own
 * line, so an exemption can be read without editing it.
 *
 * The measured scope is a package's `src`, `tests` and `scripts` directories
 * under `plugins/` and `packages/`; the repository's own `scripts/` is outside
 * it (splitting it is a card of its own). The thresholds, the scope and the
 * exemption classes are documented in `docs/VERIFICATION.md`.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const packageRoots = ["plugins", "packages"];
const sourceExtensions = /\.[cm]?[jt]sx?$/u;
const skippedDirectories = new Set(["node_modules", "dist", "coverage"]);

/** Line limits per file kind; `warn` costs a report line, `fail` costs the run. */
export const budgets = {
  source: { label: "source", warn: 1200, fail: 1400 },
  test: { label: "test", warn: 700, fail: 900 },
  // A build artifact, so a size goal is meaningless here; both numbers are a
  // runaway tripwire around the largest bundle today (qa-surface client.js at
  // ~66k lines), which is what catches a bundle that swallowed a tree.
  bundle: { label: "generated bundle", warn: 80000, fail: 100000 },
};

/**
 * Directories inside a package that a budget of `kind` applies to. `scripts` is
 * the package's own tooling, which grew under the same law as `src`, so it is
 * measured as source. The repository root's `scripts/` is not a package
 * directory and stays out of the scope until its own card splits it.
 */
const budgetedDirectories = [
  { directory: "src", kind: "source" },
  { directory: "tests", kind: "test" },
  { directory: "scripts", kind: "source" },
];

/**
 * Bundled artifacts a build writes under `lib/` — the browser bundle and both
 * typert bridges. They exist only after a build, so a run without one measures
 * nothing here and says so.
 */
const generatedArtifacts = [
  "lib/client.js",
  "lib/typert.host.js",
  "lib/typert.remote-client.js",
];

/**
 * Files the gate does not hold to their budget, each with the reason on the same
 * line. Two classes live here: the sources that were already over budget when
 * the gate landed, which leave one by one as their refactor card splits them,
 * and the package verification scripts, whose length is the shipped surface
 * they assert over rather than a module design.
 */
export const fileBudgetAllowlist = [
  {
    path: "plugins/dsh-qa-browser/src/host/session-manager.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-integrations/scripts/verify-package.mjs",
    reason:
      "assertion list over the built client bundle and the packed tarball: it grows with the shipped surface, not with a module design",
  },
  {
    path: "plugins/dsh-qa-integrations/src/client/operator-card.tsx",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-integrations/src/index.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/accounts/store.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/admin/service.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/client/QaSessionController.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/client/QaSurface.tsx",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/client/admin/QaAdmin.tsx",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/index.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-qa-surface/src/types.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-session-scope/src/client.ts",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
  {
    path: "plugins/dsh-web-fetch-authenticated/src/client/sections.tsx",
    reason: "legacy before the gate landed; owned by a refactor card",
  },
];

/**
 * Count lines the way `wc -l` reads a file: a closing newline ends the last
 * line instead of opening an empty one, so a number this gate prints is a
 * number a reader can reproduce by hand.
 */
export function countLines(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

async function directoryEntries(directory) {
  return readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
}

async function sourcesUnder(directory) {
  const files = [];
  for (const entry of await directoryEntries(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) continue;
      files.push(...(await sourcesUnder(path)));
    } else if (sourceExtensions.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

async function measure(path, repoRoot, kind) {
  const text = await readFile(path, "utf8");
  return {
    path: relative(repoRoot, path).split(sep).join("/"),
    kind,
    lines: countLines(text),
  };
}

/** Every measured file of the workspace, with its POSIX-relative path. */
export async function collectMeasuredFiles(repoRoot = workspaceRoot) {
  const measured = [];
  for (const root of packageRoots) {
    const packages = await directoryEntries(join(repoRoot, root));
    for (const entry of packages) {
      if (!entry.isDirectory()) continue;
      const packageDirectory = join(root, entry.name);
      for (const { directory, kind } of budgetedDirectories) {
        for (const file of await sourcesUnder(
          join(repoRoot, packageDirectory, directory),
        )) {
          measured.push(await measure(file, repoRoot, kind));
        }
      }
      for (const artifact of generatedArtifacts) {
        const path = join(repoRoot, packageDirectory, artifact);
        if (!existsSync(path)) continue;
        measured.push(await measure(path, repoRoot, "bundle"));
      }
    }
  }
  return measured;
}

/**
 * Read an allowlist into a `path -> reason` map. An exemption without a reason is
 * the shape a budget list decays into, so it is rejected here rather than
 * reviewed away later.
 */
function normalizeReasons(allowlist) {
  const reasons = new Map();
  for (const entry of allowlist) {
    const { path, reason } = entry ?? {};
    if (typeof path !== "string" || path === "") {
      throw new Error("file budget: allowlist entry without a path");
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(
        `file budget: allowlist entry ${path} has no reason for the exemption`,
      );
    }
    if (reasons.has(path)) {
      throw new Error(`file budget: duplicate allowlist entry for ${path}`);
    }
    reasons.set(path, reason);
  }
  return reasons;
}

/**
 * Classify every workspace file against its budget.
 *
 * Returns `{ measured, exempt, warnings, failures }`; a `failures` entry is the
 * list the CLI prints and the tests assert, a `warnings` entry never costs a
 * run, and an `exempt` entry is reported with the reason it is exempt.
 * `allowlist` is a parameter so a test can prove what an exemption does without
 * depending on the paths committed below.
 */
export async function auditFileBudget(
  repoRoot = workspaceRoot,
  { allowlist = fileBudgetAllowlist } = {},
) {
  const measured = await collectMeasuredFiles(repoRoot);
  const reasons = normalizeReasons(allowlist);
  const exempt = [];
  const warnings = [];
  const failures = [];
  const seen = new Set();

  for (const file of measured) {
    const budget = budgets[file.kind];
    seen.add(file.path);
    const exemption = reasons.get(file.path);
    if (exemption !== undefined) {
      exempt.push({ ...file, reason: exemption });
      if (file.lines <= budget.fail) {
        warnings.push({
          ...file,
          limit: budget.fail,
          reason: "within budget, drop it from fileBudgetAllowlist",
        });
      }
      continue;
    }
    if (file.lines > budget.fail) {
      failures.push({ ...file, limit: budget.fail });
    } else if (file.lines > budget.warn) {
      warnings.push({
        ...file,
        limit: budget.warn,
        reason: "over warning budget",
      });
    }
  }

  for (const path of reasons.keys()) {
    if (!seen.has(path)) {
      failures.push({
        path,
        kind: "source",
        lines: 0,
        limit: 0,
        reason:
          "allowlisted file does not exist, drop it from fileBudgetAllowlist",
      });
    }
  }

  const bySize = (left, right) => right.lines - left.lines;
  return {
    measured,
    exempt: exempt.sort(bySize),
    warnings: warnings.sort(bySize),
    failures: failures.sort(bySize),
  };
}

function describe(entry) {
  if (entry.reason !== undefined) return `${entry.path}: ${entry.reason}`;
  const { label } = budgets[entry.kind];
  return `${entry.path}: ${entry.lines} lines (${label} budget ${entry.limit})`;
}

/**
 * One line per exemption. An allowlist entry that prints nothing reads as
 * coverage, so the path and its reason are both on the line, next to the size
 * that keeps it there.
 */
function describeExemption(entry) {
  return `allowlisted: ${entry.path} — ${entry.reason} (${entry.lines} lines)`;
}

/** One line per kind, so a green run does not spend 40 lines on warnings. */
function summarize(warnings) {
  const lines = [];
  for (const [kind, budget] of Object.entries(budgets)) {
    const ofKind = warnings.filter((warning) => warning.kind === kind);
    if (ofKind.length === 0) continue;
    const noun = ofKind.length === 1 ? "file" : "files";
    const largest = ofKind[0];
    lines.push(
      `file budget: ${ofKind.length} ${budget.label} ${noun} over ${budget.warn} lines (largest ${largest.path} at ${largest.lines})`,
    );
  }
  return lines;
}

/**
 * Assert every measured file is within its budget. Throws with the offending
 * `path: lines` list, in the shape the other repository gates report failures.
 */
export async function checkFileBudget(
  repoRoot = workspaceRoot,
  options = undefined,
) {
  const report = await auditFileBudget(repoRoot, options);
  if (report.failures.length > 0) {
    throw new Error(
      `file budget failed:\n- ${report.failures.map(describe).join("\n- ")}`,
    );
  }
  return report;
}

export async function main(
  argv = process.argv.slice(2),
  repoRoot = workspaceRoot,
  options = undefined,
) {
  const report = await auditFileBudget(repoRoot, options);
  for (const entry of report.exempt) {
    console.log(describeExemption(entry));
  }
  const listed = argv.includes("--list-warnings");
  for (const line of listed
    ? report.warnings.map((warning) => `file budget: warn ${describe(warning)}`)
    : summarize(report.warnings)) {
    console.log(line);
  }
  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`file budget: ${describe(failure)}`);
    }
    console.error(
      `file budget failed: ${report.failures.length} files over budget — split them; the allowlist in scripts/check-file-budget.mjs only shrinks`,
    );
    return 1;
  }
  const bundles = report.measured.filter((file) => file.kind === "bundle");
  if (bundles.length === 0) {
    console.log(
      "file budget: 0 generated artifacts — the bundle band measures nothing before a build writes lib/",
    );
  }
  console.log(
    `file budget verified for ${report.measured.length} files (${bundles.length} generated, ${report.exempt.length} allowlisted)`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
