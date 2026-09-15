import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { globToRegExp } from "./verify-package-hygiene.mjs";

const VERSION_PLANS_DIRECTORY = path.posix.join(".nx", "version-plans");
const FRONT_MATTER_FENCE = "---";
const DEFAULT_BRANCHES = ["main", "master", "origin/main", "origin/master"];
const MAX_LISTED_FILES = 3;

/**
 * One tag per release run, created by the release workflow after npm
 * publication. It anchors every released project at once, so the tag list
 * stops growing by one tag per released package.
 */
const WAVE_TAG_GLOB = "release/*";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function toPosixPath(relative) {
  return relative.split(/[\\/]/u).join("/");
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    if (allowFailure) return undefined;
    throw new Error(`git ${args.join(" ")} failed: ${error.message}`, {
      cause: error,
    });
  }
}

function gitLines(repoRoot, args, { allowFailure = true } = {}) {
  const output = git(repoRoot, args, { allowFailure });
  if (output === undefined) return [];
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * A ref the repository cannot resolve must fail the gate: `git diff` against a
 * missing ref reports nothing, and a silent empty range would pass every
 * project as released.
 */
function resolvableRef(repoRoot, ref) {
  const resolved = git(
    repoRoot,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { allowFailure: true },
  );
  if (!resolved) {
    throw new Error(`"${ref}" is not a commit this repository can resolve`);
  }
  return resolved.trim();
}

function releaseConfiguration(repoRoot) {
  const nxConfigPath = path.join(repoRoot, "nx.json");
  if (!existsSync(nxConfigPath)) {
    throw new Error("nx.json is required to resolve the release configuration");
  }
  return readJson(nxConfigPath).release ?? {};
}

function releaseTagGlob(repoRoot, projectName) {
  const pattern = releaseConfiguration(repoRoot).releaseTag?.pattern;
  return String(pattern ?? "{projectName}@{version}")
    .replaceAll("{projectName}", projectName)
    .replaceAll("{version}", "*");
}

/**
 * Project directories the release config publishes, expanded from the
 * `release.projects` globs in nx.json so the gate follows the configuration
 * instead of a second list that can drift from it.
 */
export function releaseProjectDirectories(repoRoot) {
  const patterns = releaseConfiguration(repoRoot).projects ?? [];
  const directories = [];

  for (const pattern of patterns) {
    const normalized = toPosixPath(String(pattern));
    if (!normalized.includes("*")) {
      directories.push(normalized);
      continue;
    }

    const segments = normalized.split("/");
    const last = segments.at(-1);
    const parent = segments.slice(0, -1).join("/");
    if (last !== "*" || segments.length !== 2) {
      throw new Error(
        `unsupported release.projects pattern "${pattern}"; teach scripts/check-release-plans.mjs to expand it`,
      );
    }
    for (const entry of readdirSync(path.join(repoRoot, parent), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) directories.push(`${parent}/${entry.name}`);
    }
  }

  return directories;
}

/**
 * Release projects that publish to npm. A private project is never versioned or
 * published, so it is never asked for a version plan.
 */
export function publishableReleaseProjects(repoRoot) {
  const projects = [];

  for (const directory of releaseProjectDirectories(repoRoot)) {
    const manifestPath = path.join(repoRoot, directory, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (manifest.private === true) continue;
    projects.push({
      name: manifest.name,
      directory,
      version: manifest.version,
    });
  }

  return projects;
}

/** The newest release tag of a project that the given head can reach. */
export function lastReleaseTag(repoRoot, projectName, head) {
  const [tag] = gitLines(repoRoot, [
    "tag",
    "--list",
    releaseTagGlob(repoRoot, projectName),
    "--merged",
    head,
    "--sort=-v:refname",
  ]);
  return tag;
}

/** The newest release-wave tag (`release/*`) that the given head can reach. */
export function lastWaveTag(repoRoot, head) {
  const [tag] = gitLines(repoRoot, [
    "tag",
    "--list",
    WAVE_TAG_GLOB,
    "--merged",
    head,
    "--sort=-v:refname",
  ]);
  return tag;
}

/** Every file `git diff` reports between two refs inside a project directory. */
export function changedFiles(repoRoot, from, to, directory) {
  return gitLines(
    repoRoot,
    ["diff", "--name-only", from, to, "--", directory],
    { allowFailure: false },
  ).map(toPosixPath);
}
/**
 * Paths Nx itself ignores when it decides whether a project is touched. A
 * release commit only rewrites versions and changelogs, so a gate that counted
 * those files would demand a fresh plan for the release it just applied.
 */
function planIgnoreMatchers(repoRoot) {
  const { versionPlans } = releaseConfiguration(repoRoot);
  const patterns =
    typeof versionPlans === "object" && versionPlans !== null
      ? (versionPlans.ignorePatternsForPlanCheck ?? [])
      : [];
  return patterns.map((pattern) => globToRegExp(toPosixPath(String(pattern))));
}

/**
 * Commits no release tag covers yet, per project. The range starts at the
 * newest release-wave tag the head can reach, because a branch that released
 * its own work carries that tag the default branch does not: comparing such a
 * project against the default branch reports an already-published release as
 * unreleased and asks for plans that the release already consumed. Until the
 * first wave ships, the per-project tags of the previous release scheme keep
 * this meaning. A project without any reachable tag has never shipped, so its
 * whole change against the base is unreleased.
 */
export function unreleasedProjects({ repoRoot, base, head = "HEAD" }) {
  const ignoreMatchers = planIgnoreMatchers(repoRoot);
  const waveTag = lastWaveTag(repoRoot, head);

  return publishableReleaseProjects(repoRoot).map((project) => {
    const tag = waveTag ?? lastReleaseTag(repoRoot, project.name, head);
    const from = tag ?? base;
    const files = changedFiles(repoRoot, from, head, project.directory).filter(
      (file) => !ignoreMatchers.some((matcher) => matcher.test(file)),
    );
    return { ...project, tag, from, files };
  });
}

/** Projects a committed plan mentions, with the bump each plan asks for. */
export function readPlanBumps(repoRoot) {
  const plansRoot = path.join(repoRoot, VERSION_PLANS_DIRECTORY);
  const bumps = new Map();
  if (!existsSync(plansRoot)) return bumps;

  const planFiles = readdirSync(plansRoot)
    .filter((file) => file.endsWith(".md"))
    .sort();

  for (const planFile of planFiles) {
    const lines = readFileSync(path.join(plansRoot, planFile), "utf8").split(
      "\n",
    );
    // Nx ignores a plan that does not open with the fence, so the gate reads the
    // file the same way; verify-package-hygiene.mjs is what fails such a plan.
    if (lines[0]?.trim() !== FRONT_MATTER_FENCE) continue;
    const closingFence = lines.findIndex(
      (line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE,
    );
    if (closingFence === -1) continue;

    for (const entry of lines.slice(1, closingFence)) {
      const match = /^(?<key>.+?)\s*:\s*(?<bump>\S+)$/u.exec(entry.trim());
      if (!match) continue;
      const project = match.groups.key.replace(/^"|"$/gu, "");
      bumps.set(project, [
        ...(bumps.get(project) ?? []),
        { plan: planFile, bump: match.groups.bump },
      ]);
    }
  }

  return bumps;
}

/**
 * Working-tree edits inside release projects. The gate reads commits, like the
 * release does, so an agent that has not committed yet is told why its change is
 * not part of the answer instead of concluding the gate is broken.
 */
export function uncommittedChanges(repoRoot, directories) {
  if (directories.length === 0) return [];
  return gitLines(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ...directories,
  ]);
}

/** The ref the branch is compared against when no base is given. */
export function resolveBase(repoRoot, explicit) {
  if (explicit) return explicit;
  if (process.env.NX_BASE) return process.env.NX_BASE;

  for (const candidate of DEFAULT_BRANCHES) {
    const resolved = git(
      repoRoot,
      ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
      { allowFailure: true },
    );
    if (resolved) return candidate;
  }

  throw new Error(
    `no default branch found among ${DEFAULT_BRANCHES.join(", ")}; pass --base=<ref>`,
  );
}

function shortSha(repoRoot, ref) {
  return (
    git(repoRoot, ["rev-parse", "--short", ref], {
      allowFailure: true,
    })?.trim() ?? ref
  );
}

function describeFiles(files) {
  const listed = files.slice(0, MAX_LISTED_FILES).join(", ");
  const rest = files.length - MAX_LISTED_FILES;
  return rest > 0 ? `${listed} (+${rest} more)` : listed;
}

export function inspectReleasePlans({
  repoRoot = process.cwd(),
  base,
  head = "HEAD",
} = {}) {
  const resolvedBase = resolveBase(repoRoot, base);
  resolvableRef(repoRoot, resolvedBase);
  resolvableRef(repoRoot, head);
  const projects = unreleasedProjects({ repoRoot, base: resolvedBase, head });
  const planned = readPlanBumps(repoRoot);
  const unreleased = projects.filter((project) => project.files.length > 0);

  return {
    repoRoot,
    base: resolvedBase,
    head,
    projects,
    planned,
    uncommitted: uncommittedChanges(
      repoRoot,
      projects.map((project) => project.directory),
    ),
    missing: unreleased.filter((project) => !planned.has(project.name)),
    covered: unreleased.filter((project) => planned.has(project.name)),
    released: projects.filter((project) => project.files.length === 0),
  };
}

function report(result, { verbose = false } = {}) {
  const scope = `base ${result.base} (${shortSha(result.repoRoot, result.base)}) -> ${result.head} (${shortSha(result.repoRoot, result.head)})`;

  if (result.missing.length > 0) {
    const lines = [
      `version plans: ${result.missing.length} project(s) carry unreleased changes with no version plan`,
      "",
    ];
    for (const project of result.missing) {
      const since = project.tag
        ? `since ${project.tag}`
        : `since ${result.base} (never released)`;
      lines.push(
        `  ${project.name}: ${project.files.length} file(s) ${since}`,
        `    ${describeFiles(project.files)}`,
      );
    }
    lines.push(
      "",
      "Add a version plan for each project above with `pnpm release:plan`, so the",
      "next release versions and documents the change.",
      "",
      scope,
    );
    return { ok: false, lines };
  }

  const lines = [
    `version plans: ${result.covered.length} of ${result.projects.length} publishable project(s) carry unreleased changes, all covered by a plan`,
    `version plans: ${result.released.length} project(s) were released at or after their last change, so they need no plan`,
  ];
  if (verbose) {
    for (const project of result.covered) {
      lines.push(
        `  covered: ${project.name} (${project.files.length} file(s) since ${project.tag})`,
        ...result.planned
          .get(project.name)
          .map((entry) => `    ${entry.bump} in ${entry.plan}`),
      );
    }
    for (const project of result.released) {
      lines.push(
        `  released: ${project.name} (no change since ${project.tag ?? result.base})`,
      );
    }
  }
  if (result.uncommitted.length > 0) {
    lines.push(
      `version plans: ${result.uncommitted.length} path(s) under release projects are uncommitted, and are checked once committed`,
    );
  }
  lines.push(scope);
  return { ok: true, lines };
}

export function main(argv = process.argv.slice(2)) {
  const option = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  try {
    const result = inspectReleasePlans({
      base: option("base"),
      head: option("head") || process.env.NX_HEAD || "HEAD",
    });
    const { ok, lines } = report(result, {
      verbose: argv.includes("--verbose"),
    });
    const write = ok
      ? process.stdout.write.bind(process.stdout)
      : process.stderr.write.bind(process.stderr);
    write(`${lines.join("\n")}\n`);
    return ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `version plans: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main());
}
