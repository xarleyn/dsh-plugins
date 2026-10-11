import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FRONT_MATTER_FENCE = "---";
const QA_SURFACE_DIRECTORY = path.join("plugins", "dsh-qa-surface");
const QA_SURFACE_PROJECT = "@yadsh/dsh-qa-surface";
const QA_CHANGELOG_SOURCE = path.join(
  "src",
  "client",
  "components",
  "QaChangelog.tsx",
);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Semver precedence for the versions the curated changelog declares. */
export function compareVersions(a, b) {
  const parse = (version) => {
    const separator = version.indexOf("-");
    const core = separator === -1 ? version : version.slice(0, separator);
    const prerelease = separator === -1 ? "" : version.slice(separator + 1);
    const [major = 0, minor = 0, patch = 0] = core
      .split(".")
      .map((part) => Number(part));
    return { major, minor, patch, prerelease };
  };

  const left = parse(a);
  const right = parse(b);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  // A prerelease precedes the release of the same core.
  if (left.prerelease !== right.prerelease) {
    if (left.prerelease === "") return 1;
    if (right.prerelease === "") return -1;
    const ids = [left.prerelease.split("."), right.prerelease.split(".")];
    for (
      let index = 0;
      index < Math.max(ids[0].length, ids[1].length);
      index += 1
    ) {
      const [x, y] = [ids[0][index], ids[1][index]];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const numeric = [/^\d+$/u.test(x), /^\d+$/u.test(y)];
      if (numeric[0] && numeric[1]) {
        const delta = Number(x) - Number(y);
        if (delta !== 0) return delta < 0 ? -1 : 1;
      } else if (numeric[0] !== numeric[1]) {
        return numeric[0] ? -1 : 1;
      } else if (x !== y) {
        return x < y ? -1 : 1;
      }
    }
  }
  return 0;
}

/** Project names a plan's front matter declares bumps for. */
export function planProjects(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) return [];
  const closingFence = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE,
  );
  if (closingFence === -1) return [];
  return lines
    .slice(1, closingFence)
    .map((line) => /^(?<key>.+?)\s*:\s*\S+$/u.exec(line.trim())?.groups.key)
    .filter((key) => key !== undefined)
    .map((key) => key.replace(/^"|"$/gu, ""));
}

/**
 * The version literals of the curated end-user changelog (QaChangelog.tsx),
 * where each entry declares `version: "x.y.z"` as a plain literal.
 */
export function curatedChangelogVersions(changelogSource) {
  return [...changelogSource.matchAll(/\bversion:\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
}

/**
 * The curated changelog split into one raw block per entry: the source text
 * from a `version: "x.y.z"` literal up to the next one, cut at the closing of
 * the array so the rendering code below the list is never part of an entry.
 * Comparing blocks verbatim is what lets the frozen-section gate see a prose
 * edit without parsing TypeScript, and it keeps an entry added above the
 * released ones from changing the block of any entry already published.
 */
export function curatedChangelogBlocks(changelogSource) {
  const matches = [...changelogSource.matchAll(/\bversion:\s*"([^"]+)"/gu)];
  const arrayEnd = changelogSource.indexOf("\n];");
  const blocks = new Map();
  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const ends = [next === undefined ? changelogSource.length : next.index];
    if (arrayEnd !== -1) ends.push(arrayEnd);
    blocks.set(match[1], changelogSource.slice(match.index, Math.min(...ends)));
  });
  return blocks;
}

/**
 * AGENTS.md ("a released section is frozen"): a branch may not rewrite what a
 * wave published. The sidebar test cannot see this — it compares the *list* of
 * versions against CHANGELOG.md, so a line slipped into an already published
 * section leaves the list untouched and stays green, while the deployed note
 * now claims a fix that shipped in an earlier version.
 *
 * `baseSource` is the same file as the branch's own merge base. A section the
 * branch did not write is not the branch's doing: a head that predates the wave
 * simply carries an older file, and rebasing is what seats it back, so only a
 * section whose current text differs from both the published text and the
 * branch's own starting text is reported.
 */
export function validateQaChangelogFrozenSections(
  changelogSource,
  releasedSource,
  baseSource = null,
) {
  // `git show` hands back the blob (LF through .gitattributes) while a checkout
  // can hand back CRLF; a line-ending difference is not an edited section.
  const normalize = (source) => source.replace(/\r\n/gu, "\n");
  const released = curatedChangelogBlocks(normalize(releasedSource));
  const working = curatedChangelogBlocks(normalize(changelogSource));
  // Without a base there is nothing to attribute the difference to, so the
  // published text is simply held to.
  const blameEverything = baseSource === null || baseSource === undefined;
  const base = blameEverything
    ? new Map()
    : curatedChangelogBlocks(normalize(baseSource));
  const failures = [];
  for (const [version, block] of released) {
    const current = working.get(version);
    if (current === block) continue;
    if (!blameEverything && base.get(version) === current) continue;
    if (current === undefined) {
      failures.push(
        `plugins/dsh-qa-surface: QaChangelog.tsx drops the entry of the released version ${version}; a published section is frozen — rebase onto the line and put your note in the entry of the version your plans bump to`,
      );
      continue;
    }
    failures.push(
      `plugins/dsh-qa-surface: QaChangelog.tsx changes the entry of the released version ${version} away from what that wave published; a published section is frozen — rebase onto the line and put your note in the entry of the version your plans bump to`,
    );
  }
  return failures;
}

/**
 * A curated entry newer than the manifest version promises the user a release
 * that only a version plan can produce. `validateQaChangelogCoverage` checks
 * the other direction (a plan demands its entry); together they pin the set of
 * pending entries to exactly the version the qa-surface plans bump to, so a
 * note committed without its plan cannot reach the deployed sidebar as a
 * version that never shipped. An entry the branch inherited from its own base
 * is not the branch's doing — rebasing resolves it — so `baseChangelogSource`
 * keeps the message on the note this branch actually added.
 */
export function validateQaChangelogPlannedEntries(
  changelogSource,
  currentVersion,
  plans,
  baseChangelogSource = null,
) {
  const qaSurfacePlans = plans.filter((plan) =>
    planProjects(plan.content).includes(QA_SURFACE_PROJECT),
  );
  let allowed;
  if (qaSurfacePlans.length === 0) {
    allowed = new Set();
  } else {
    const bumpOrder = { patch: 0, minor: 1, major: 2 };
    const bumps = qaSurfacePlans
      .map((plan) => planBumpFor(plan.content, QA_SURFACE_PROJECT))
      .filter((bump) => bump !== undefined);
    // Unparseable front matter and a non-numeric manifest version are already
    // reported by validateVersionPlan and validateQaChangelogCoverage; guessing
    // a second version here would only add a misleading message.
    if (bumps.length === 0) return [];
    const highestBump = Object.keys(bumpOrder)
      .filter((bump) => bumps.includes(bump))
      .sort((a, b) => bumpOrder[b] - bumpOrder[a])
      .at(0);
    const plannedVersion = incrementVersion(currentVersion, highestBump);
    if (plannedVersion === undefined) return [];
    allowed = new Set([plannedVersion]);
  }
  const inherited = new Set(
    baseChangelogSource === null
      ? []
      : curatedChangelogVersions(baseChangelogSource.replace(/\r\n/gu, "\n")),
  );
  return [
    ...new Set(
      curatedChangelogVersions(changelogSource).filter(
        (version) =>
          compareVersions(version, currentVersion) > 0 &&
          !allowed.has(version) &&
          !inherited.has(version),
      ),
    ),
  ].map(
    (version) =>
      `plugins/dsh-qa-surface: QaChangelog.tsx has an entry for ${version}, newer than the released ${currentVersion}, but no qa-surface version plan bumps to it — a curated note without a plan names a release that will not happen`,
  );
}

/** Read git without treating an absent ref as an empty successful check. */
function gitText(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr?.trim() || result.error?.message || result.status}`,
    );
  }
  return result.stdout.trim();
}

/**
 * Published waves are global, including a wave this branch does not reach yet.
 * Compare with the branch's merge base so inherited stale notes are not blamed
 * on its author. An explicit PR base takes precedence for attribution.
 */
export function qaChangelogBaselines(repoRoot, { base, head = "HEAD" } = {}) {
  if (base !== undefined) {
    try {
      gitText(repoRoot, ["rev-parse", "--verify", `${base}^{commit}`]);
    } catch {
      throw new Error(`"${base}" is not a commit this repository can resolve`);
    }
  }
  // Fixture directories and source archives have no git history to measure.
  const repository = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (repository.status !== 0) return null;
  gitText(repoRoot, ["rev-parse", "--verify", `${head}^{commit}`]);
  const tag = gitText(repoRoot, [
    "tag",
    "--list",
    "release/*",
    "--sort=-v:refname",
  ])
    .split(/\r?\n/u)
    .filter(Boolean)[0];
  if (tag === undefined) return null;
  const gitPath = `${QA_SURFACE_DIRECTORY.split(path.sep).join("/")}/${QA_CHANGELOG_SOURCE.split(path.sep).join("/")}`;
  const released = gitText(repoRoot, ["show", `${tag}:${gitPath}`]);
  const manifest = JSON.parse(
    gitText(repoRoot, [
      "show",
      `${tag}:${QA_SURFACE_DIRECTORY.split(path.sep).join("/")}/package.json`,
    ]),
  );
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(manifest.version)
  ) {
    throw new Error(
      `${tag}: qa-surface published manifest has no valid version`,
    );
  }
  const mergeBase = gitText(repoRoot, ["merge-base", base ?? tag, head]);
  // A file absent from the merge base was introduced by this branch.
  const inherited = spawnSync("git", ["show", `${mergeBase}:${gitPath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (
    inherited.status !== 0 &&
    !/does not exist|exists on disk, but not in/u.test(inherited.stderr ?? "")
  ) {
    throw new Error(
      `cannot read curated changelog at ${mergeBase}: ${inherited.stderr}`,
    );
  }
  return {
    tag,
    version: manifest.version,
    released,
    base: inherited.status === 0 ? inherited.stdout : null,
  };
}

/**
 * The semver bump a version plan declares for one project, read from the
 * front matter (`"project": patch|minor|major`).
 */
export function planBumpFor(content, project) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) return undefined;
  const closingFence = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE,
  );
  if (closingFence === -1) return undefined;
  const escaped = project.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = lines
    .slice(1, closingFence)
    .map((line) =>
      new RegExp(`^"${escaped}"\\s*:\\s*(patch|minor|major)\\s*$`, "u").exec(
        line.trim(),
      ),
    )
    .find((match) => match !== null);
  return match?.[1];
}

/**
 * The version one semver bump step away from `version`. A version outside
 * the numeric `x.y.z` core (prerelease suffixes are tolerated but ignored)
 * yields undefined, so callers can fall back to a weaker check.
 */
export function incrementVersion(version, bump) {
  const core = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/u.exec(version);
  if (core === null) return undefined;
  const [major, minor, patch] = [
    Number(core.groups.major),
    Number(core.groups.minor),
    Number(core.groups.patch),
  ];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * AGENTS.md ("QA surface release notes"): a version plan for the qa-surface
 * project must come with a curated changelog entry for exactly the version
 * the plans currently bump to — the highest bump across the qa-surface plans
 * applied to the manifest's current version. Tying the gate to the computed
 * version keeps it satisfied by a stale future entry: once 0.8.0 exists, the
 * next planned release must update QaChangelog.tsx again.
 */
export function validateQaChangelogCoverage(repoRoot, plans, publishedVersion) {
  const qaSurfacePlans = plans.filter((plan) =>
    planProjects(plan.content).includes(QA_SURFACE_PROJECT),
  );
  if (qaSurfacePlans.length === 0) return [];

  const packageDirectory = path.join(repoRoot, QA_SURFACE_DIRECTORY);
  const manifestPath = path.join(packageDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    return [
      "plugins/dsh-qa-surface: version plans declare the project, but its package.json is missing",
    ];
  }
  const currentVersion = readJson(manifestPath).version;
  const consumed = qaSurfacePlans.flatMap((plan) => {
    const bump = planBumpFor(plan.content, QA_SURFACE_PROJECT);
    const target =
      bump === undefined ? undefined : incrementVersion(currentVersion, bump);
    return target !== undefined &&
      publishedVersion !== undefined &&
      compareVersions(target, publishedVersion) <= 0
      ? [
          `${plan.file}: qa-surface target ${target} is already published (${publishedVersion}); rebase onto the released line and replace the consumed plan`,
        ]
      : [];
  });
  if (consumed.length > 0) return consumed;

  const changelogPath = path.join(packageDirectory, QA_CHANGELOG_SOURCE);
  if (!existsSync(changelogPath)) {
    return [
      "plugins/dsh-qa-surface: version plans declare the project, but src/client/components/QaChangelog.tsx is missing",
    ];
  }
  const versions = curatedChangelogVersions(
    readFileSync(changelogPath, "utf8"),
  );
  const bumpOrder = { patch: 0, minor: 1, major: 2 };
  const bumps = qaSurfacePlans
    .map((plan) => planBumpFor(plan.content, QA_SURFACE_PROJECT))
    .filter((bump) => bump !== undefined);
  if (bumps.length === 0) {
    // Unparseable plans fall back to the weaker tripwire: some entry newer
    // than the current version. validateVersionPlan already rejects damaged
    // front matter, so this is a safety net rather than the main check.
    if (
      versions.some((version) => compareVersions(version, currentVersion) > 0)
    ) {
      return [];
    }
    return [
      `plugins/dsh-qa-surface: a version plan declares the project, but QaChangelog.tsx has no entry newer than the current ${currentVersion}; add the planned version to QA_CHANGELOG in the same change`,
    ];
  }
  const highestBump = Object.keys(bumpOrder)
    .filter((bump) => bumps.includes(bump))
    .sort((a, b) => bumpOrder[b] - bumpOrder[a])
    .at(0);
  const plannedVersion = incrementVersion(currentVersion, highestBump);
  if (plannedVersion === undefined) {
    return [
      `plugins/dsh-qa-surface: the manifest version ${currentVersion} is not a numeric x.y.z release, so the planned changelog version cannot be derived`,
    ];
  }
  if (versions.includes(plannedVersion)) return [];
  return [
    `plugins/dsh-qa-surface: the qa-surface version plans bump to ${plannedVersion}, but QaChangelog.tsx has no entry for it; add the planned version to QA_CHANGELOG in the same change`,
  ];
}
