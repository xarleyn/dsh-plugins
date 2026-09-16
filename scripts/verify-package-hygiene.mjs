import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findManifestDrift } from "./generate-plugins-manifest.mjs";

const REQUIRED_FILES = [
  "compatibility.json",
  "cordis.patch.yml",
  "LICENSE",
  "README.md",
];

const STANDARD_TYPES_LAYOUTS = new Set([
  "./lib/index.d.ts",
  "./lib/types/index.d.ts",
]);

const CANONICAL_REPOSITORY_URL =
  "git+https://github.com/xarleyn/dsh-plugins.git";
const CANONICAL_BUGS_URL = "https://github.com/xarleyn/dsh-plugins/issues";
const HOMEPAGE_PREFIX = "https://github.com/xarleyn/dsh-plugins/tree/main";
const BLOB_PREFIX = "https://github.com/xarleyn/dsh-plugins/blob/main";
// Packages are discovered through these keywords by DSH indexes and npm
// search; a package missing them is invisible to the ecosystem even though it
// publishes correctly. The canonical set a package should carry is
// `deepseek`, `deepseek-harness`, `dsh`, `dsh-plugin`, `cordis` — the plugin
// generator emits all five — and the gate hard-requires the four DSH indexes
// match on, so the contract cannot drift unnoticed.
const REQUIRED_KEYWORDS = ["deepseek-harness", "dsh", "dsh-plugin", "cordis"];

const VERSION_PLANS_DIRECTORY = path.join(".nx", "version-plans");
const FRONT_MATTER_FENCE = "---";
const QA_SURFACE_DIRECTORY = path.join("plugins", "dsh-qa-surface");
const QA_SURFACE_PROJECT = "@yadsh/dsh-qa-surface";
const QA_CHANGELOG_SOURCE = path.join(
  "src",
  "client",
  "components",
  "QaChangelog.tsx",
);
// A plugin registers its configuration card under this client slot, and the
// registration must stay guarded by the shared verification contract.
const SETTINGS_CARD_SLOT = "settings.plugin.item";
const CARD_CONTRACT_MODULE = "verify-plugin-card-contract";
const RELEASE_TYPES = new Set([
  "major",
  "minor",
  "patch",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
]);
// Nx rewrites these conventional-commit aliases before validating the bump.
const RELEASE_TYPE_ALIASES = new Map([
  ["feat", "minor"],
  ["fix", "patch"],
  ["feat!", "major"],
  ["fix!", "major"],
]);

const REQUIRED_PLUGIN_SCRIPTS = [
  "lint",
  "typecheck",
  "build",
  "verify:package",
  "verify",
  "check",
  "prepack",
];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Keep package-local commands composable by Nx and pnpm. Formatting is a
 * repository concern, while every plugin check runs all of its declared code
 * gates before the build/package verification steps.
 */
export function validateWorkspaceScripts(directory, { plugin = false } = {}) {
  const manifest = readJson(path.join(directory, "package.json"));
  const scripts = manifest.scripts ?? {};
  const errors = [];

  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== "string") continue;
    if (/(?:^|\s|&&|\|\|)npm(?:\s|$)/u.test(command)) {
      errors.push(`scripts.${name} must use pnpm, not npm`);
    }

    for (const match of command.matchAll(
      /\b(?:pnpm|npm) run (?<target>[a-z0-9:_-]+)/giu,
    )) {
      const target = match.groups?.target;
      if (target && typeof scripts[target] !== "string") {
        errors.push(`scripts.${name} calls missing local script "${target}"`);
      }
    }
  }

  if (!plugin) return errors;

  for (const name of REQUIRED_PLUGIN_SCRIPTS) {
    if (typeof scripts[name] !== "string") {
      errors.push(`scripts.${name} is required for every plugin`);
    }
  }

  const expectedCheck = [
    "pnpm run lint",
    "pnpm run typecheck",
    ...(typeof scripts.test === "string" ? ["pnpm run test"] : []),
    "pnpm run build",
    "pnpm run verify",
  ].join(" && ");
  if (typeof scripts.check === "string" && scripts.check !== expectedCheck) {
    errors.push(`scripts.check must equal "${expectedCheck}"`);
  }
  if (
    typeof scripts.verify === "string" &&
    !scripts.verify.includes("pnpm run verify:package")
  ) {
    errors.push('scripts.verify must include "pnpm run verify:package"');
  }
  if (
    typeof scripts.prepack === "string" &&
    !scripts.prepack.includes("pnpm run build")
  ) {
    errors.push('scripts.prepack must include "pnpm run build"');
  }

  return errors;
}

export function validatePublishablePlugin(directory) {
  const errors = [];
  const manifestPath = path.join(directory, "package.json");
  const manifest = readJson(manifestPath);
  if (manifest.private === true) return errors;

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(directory, file))) {
      errors.push(`${file} is missing`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes(file)) {
      errors.push(`${file} is missing from package.json files`);
    }
  }

  if (manifest.exports?.["./package.json"] !== "./package.json") {
    errors.push('exports["./package.json"] must equal "./package.json"');
  }

  const rootExport = manifest.exports?.["."];
  const exportedTypes =
    typeof rootExport === "object" && rootExport !== null
      ? rootExport.types
      : undefined;
  if (manifest.types !== exportedTypes) {
    errors.push('package types must match exports["."].types');
  }

  if (!STANDARD_TYPES_LAYOUTS.has(manifest.types)) {
    errors.push(
      `unsupported declaration layout ${JSON.stringify(manifest.types)}; ` +
        "use ./lib/index.d.ts or ./lib/types/index.d.ts",
    );
  }

  const compatibilityPath = path.join(directory, "compatibility.json");
  if (existsSync(compatibilityPath)) {
    const compatibility = readJson(compatibilityPath);
    const harness = compatibility.deepseekHarness;
    if (typeof harness?.range !== "string" || harness.range.length === 0) {
      errors.push("compatibility.json must declare deepseekHarness.range");
    }
    if (
      !Array.isArray(harness?.testedReleases) ||
      harness.testedReleases.length === 0 ||
      harness.testedReleases.some(
        (release) => typeof release !== "string" || release.length === 0,
      )
    ) {
      errors.push(
        "compatibility.json must declare at least one tested DSH release",
      );
    }
    if (compatibility.node !== manifest.engines?.node) {
      errors.push(
        "compatibility.json node must exactly match package.json engines.node",
      );
    }
  }

  return errors;
}

function toPosixPath(relative) {
  return relative.split(/[\\/]/u).join("/");
}

// npm renders the README on the package page, so a manifest may publish it, its
// legal notices, and the images the README embeds — nothing else. Specs,
// changelogs, roadmaps, design docs, and README translations stay in the
// repository where a reader can still find them.
const PUBLISHED_MARKDOWN = new Set([
  "README.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
]);
// npm always ships these regardless of the `files` list. A translated README
// (`README.ru.md`) is not one of them.
const ALWAYS_SHIPPED = [
  "package.json",
  /^readme(\.(md|markdown|txt))?$/iu,
  /^licen[cs]e(\.(md|txt))?$/iu,
];

export function globToRegExp(pattern) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    // `**/` also matches no directory at all, so `lib/**/*.js` covers `lib/a.js`.
    .replace(/\*\*\//gu, "(?:.*/)?")
    .replace(/\*\*/gu, ".*")
    .replace(/\*/gu, "[^/]*");
  return new RegExp(`^${source}$`, "u");
}

/** True when a `files` entry (or its glob) covers the given relative path. */
export function matchesFilesEntry(entry, target) {
  if (entry === target) return true;
  if (entry.includes("*")) return globToRegExp(entry).test(target);
  // A bare directory entry publishes everything below it.
  return target.startsWith(`${entry}/`);
}

/** True when the published tarball carries the given relative path. */
export function isPublishedFile(files, target) {
  if (
    ALWAYS_SHIPPED.some((rule) =>
      typeof rule === "string" ? rule === target : rule.test(target),
    )
  ) {
    return true;
  }
  return files.some((entry) => matchesFilesEntry(entry, target));
}

/** Extracts every relative link target from a markdown document. */
function relativeLinkTargets(text) {
  const targets = [];
  const patterns = [
    /\[[^\]]*\]\((?<target>[^)\s]+)(?:\s+"[^"]*")?\)/gu,
    /(?:src|href)="(?<target>[^"]+)"/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match.groups.target;
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/iu.test(raw)) continue;
      const target = decodeURIComponent(raw.split("#")[0].split("?")[0]);
      if (target === "" || target.endsWith("/")) continue;
      targets.push(target);
    }
  }
  return targets;
}

/** Package-relative form of a link target, with `./` dropped and `..` resolved. */
export function normalizeLinkTarget(target) {
  return path.posix.normalize(toPosixPath(target));
}

/** Repository URL for a document that stays out of the published tarball. */
export function repositoryBlobUrl(packageRelative, target) {
  return `${BLOB_PREFIX}/${path.posix.normalize(
    path.posix.join(packageRelative, normalizeLinkTarget(target)),
  )}`;
}

/**
 * A published tarball carries the runtime, the bundle patch, compatibility
 * data, legal notices, and the README — not the repository's documentation.
 * Shipping docs inflates every install, and it is not what the registry is for;
 * the same rule keeps the README honest, because a relative link to a file the
 * tarball omits renders as a dead link on the package page.
 */
export function validatePublishedContent(directory, repoRoot = process.cwd()) {
  const errors = [];
  const manifestPath = path.join(directory, "package.json");
  if (!existsSync(manifestPath)) return errors;
  const manifest = readJson(manifestPath);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const packageRelative = toPosixPath(path.relative(repoRoot, directory));

  for (const entry of files) {
    const normalized = toPosixPath(entry);
    if (normalized.endsWith(".md") && !PUBLISHED_MARKDOWN.has(normalized)) {
      errors.push(
        `files must not publish documentation: "${normalized}" stays in the repository`,
      );
      continue;
    }
    if (
      normalized.startsWith("docs/") &&
      !normalized.startsWith("docs/images/")
    ) {
      errors.push(
        `files must not publish documentation: "${normalized}" stays in the repository`,
      );
    }
  }

  const readmePath = path.join(directory, "README.md");
  if (!existsSync(readmePath)) return errors;
  const reported = new Set();
  for (const target of relativeLinkTargets(readFileSync(readmePath, "utf8"))) {
    const normalized = normalizeLinkTarget(target);
    if (!normalized.startsWith("../") && isPublishedFile(files, normalized)) {
      continue;
    }
    if (reported.has(normalized)) continue;
    reported.add(normalized);
    errors.push(
      `README links to "${normalized}", which the tarball does not ship; link to "${repositoryBlobUrl(packageRelative, normalized)}" instead`,
    );
  }

  return errors;
}

/**
 * Published manifests carry the discoverability contract: npm shows them on the
 * package page, and DSH indexes read keywords and the monorepo directory to
 * attribute a package to its sources. A package without them looks unpublished
 * or unmaintained even though the tarball installs fine.
 */
export function validateDiscoverability(directory, repoRoot = process.cwd()) {
  const errors = [];
  const manifestPath = path.join(directory, "package.json");
  if (!existsSync(manifestPath)) return errors;
  const manifest = readJson(manifestPath);

  const relative = toPosixPath(path.relative(repoRoot, directory));
  const repository = manifest.repository;
  if (
    repository?.type !== "git" ||
    repository?.url !== CANONICAL_REPOSITORY_URL
  ) {
    errors.push(
      `repository must be { type: "git", url: "${CANONICAL_REPOSITORY_URL}", directory: "${relative}" }`,
    );
  } else if (repository.directory !== relative) {
    errors.push(`repository.directory must be "${relative}"`);
  }

  const homepage = `${HOMEPAGE_PREFIX}/${relative}#readme`;
  if (manifest.homepage !== homepage) {
    errors.push(`homepage must be "${homepage}"`);
  }

  if (manifest.bugs?.url !== CANONICAL_BUGS_URL) {
    errors.push(`bugs.url must be "${CANONICAL_BUGS_URL}"`);
  }

  if (
    typeof manifest.description !== "string" ||
    manifest.description.trim() === "" ||
    !/(deepseek harness|dsh)/iu.test(manifest.description)
  ) {
    errors.push(
      "description must name DeepSeek Harness (or DSH) so the package is searchable",
    );
  }

  const keywords = manifest.keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    errors.push("keywords must be a non-empty array");
  } else {
    for (const keyword of REQUIRED_KEYWORDS) {
      if (!keywords.includes(keyword)) {
        errors.push(`keywords must include "${keyword}"`);
      }
    }
    if (new Set(keywords).size !== keywords.length) {
      errors.push("keywords must not repeat");
    }
    if (keywords.some((keyword) => keyword !== keyword.toLowerCase())) {
      errors.push("keywords must be lowercase");
    }
  }

  if (
    typeof manifest.name !== "string" ||
    !manifest.name.startsWith("@yadsh/")
  ) {
    errors.push(
      'name must stay inside the "@yadsh/" scope so the documented install command resolves',
    );
  }

  return errors;
}

export function verifyPublishablePlugins(repoRoot = process.cwd()) {
  const failures = [];
  let verified = 0;

  for (const group of ["plugins", "packages"]) {
    const groupRoot = path.join(repoRoot, group);
    if (!existsSync(groupRoot)) continue;
    for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(groupRoot, entry.name);
      if (!existsSync(path.join(directory, "package.json"))) continue;
      const manifest = readJson(path.join(directory, "package.json"));
      for (const error of validateWorkspaceScripts(directory, {
        plugin: group === "plugins",
      })) {
        failures.push(`${manifest.name}: ${error}`);
      }
      if (group === "plugins") {
        for (const error of validateClientContractGates(directory, manifest)) {
          failures.push(`${manifest.name}: ${error}`);
        }
      }
      if (manifest.private === true) continue;
      verified += 1;
      const errors = [
        // Only plugin directories carry the Cordis patch and client contract.
        ...(group === "plugins" ? validatePublishablePlugin(directory) : []),
        ...validateDiscoverability(directory, repoRoot),
        ...validatePublishedContent(directory, repoRoot),
      ];
      for (const error of errors) {
        failures.push(`${manifest.name}: ${error}`);
      }
    }
  }

  for (const error of findManifestDrift(repoRoot)) {
    failures.push(`catalog: ${error}`);
  }

  if (failures.length > 0) {
    throw new Error(
      `publishable plugin hygiene failed:\n- ${failures.join("\n- ")}`,
    );
  }
  return verified;
}

function readWorkspacePackageNames(repoRoot) {
  const names = new Set();
  for (const group of ["plugins", "packages"]) {
    const groupRoot = path.join(repoRoot, group);
    if (!existsSync(groupRoot)) continue;
    for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(groupRoot, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      names.add(readJson(manifestPath).name);
    }
  }
  return names;
}

function walkFiles(directory, out = []) {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function anyScriptMentions(directory, needle) {
  return walkFiles(directory).some((file) =>
    readFileSync(file, "utf8").includes(needle),
  );
}

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
 * AGENTS.md ("QA surface release notes"): a version plan for the qa-surface
 * project must come with a curated changelog entry for a version strictly
 * newer than the manifest's current version. The gate is a tripwire — it
 * only fires when qa-surface has plans but no such record at all.
 */
export function validateQaChangelogCoverage(repoRoot, plans) {
  const mentionsQaSurface = plans.some((plan) =>
    planProjects(plan.content).includes(QA_SURFACE_PROJECT),
  );
  if (!mentionsQaSurface) return [];

  const packageDirectory = path.join(repoRoot, QA_SURFACE_DIRECTORY);
  const manifestPath = path.join(packageDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    return [
      "plugins/dsh-qa-surface: version plans declare the project, but its package.json is missing",
    ];
  }
  const currentVersion = readJson(manifestPath).version;

  const changelogPath = path.join(packageDirectory, QA_CHANGELOG_SOURCE);
  if (!existsSync(changelogPath)) {
    return [
      "plugins/dsh-qa-surface: version plans declare the project, but src/client/components/QaChangelog.tsx is missing",
    ];
  }
  const versions = curatedChangelogVersions(
    readFileSync(changelogPath, "utf8"),
  );
  if (
    versions.some((version) => compareVersions(version, currentVersion) > 0)
  ) {
    return [];
  }
  return [
    `plugins/dsh-qa-surface: a version plan declares the project, but QaChangelog.tsx has no entry newer than the current ${currentVersion}; add the planned version to QA_CHANGELOG in the same change`,
  ];
}

/**
 * A plugin that ships a browser bundle must keep a verification script that
 * asserts the bundle registration id equals the full package name, and a
 * plugin registering a configuration card must route its client through the
 * shared card-contract gate — the AGENTS.md contracts the bundles can
 * otherwise drift away from unnoticed.
 */
export function validateClientContractGates(directory, manifest) {
  const errors = [];
  const scripts = path.join(directory, "scripts");
  const sources = path.join(directory, "src");

  if (manifest.dsh?.client) {
    const directoryName = path.basename(directory);
    // Regex literals escape the slash (`@yadsh\/name`), so compare with the
    // escapes dropped before looking for the full package name.
    const asserted = walkFiles(scripts)
      .filter((file) => file.endsWith(".mjs"))
      .some((file) =>
        readFileSync(file, "utf8")
          .replaceAll("\\", "")
          .includes(`@yadsh/${directoryName}`),
      );
    if (!asserted) {
      errors.push(
        `dsh.client is declared, but no scripts/*.mjs asserts the full package name "@yadsh/${directoryName}"; assert it in verify-package.mjs or verify-client-bundle.mjs`,
      );
    }
  }

  if (
    walkFiles(sources).some((file) =>
      readFileSync(file, "utf8").includes(SETTINGS_CARD_SLOT),
    )
  ) {
    if (!anyScriptMentions(scripts, CARD_CONTRACT_MODULE)) {
      errors.push(
        `src registers a "${SETTINGS_CARD_SLOT}" card, but no script in scripts/ runs ${CARD_CONTRACT_MODULE}.mjs; call it from verify-package.mjs or verify-client-bundle.mjs`,
      );
    }
  }

  return errors;
}

/**
 * Nx reads a plan only when the file opens with the `---` front-matter fence
 * and otherwise ignores it without a warning, so a damaged plan silently stops
 * bumping its package. Reproduce Nx's parsing rules to fail loudly instead.
 */
export function validateVersionPlan(fileName, content, knownProjects) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) {
    return [
      `${fileName}: the front matter must open with --- on the first line; nx ignores a plan without it`,
    ];
  }

  const closingFence = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE,
  );
  if (closingFence === -1) {
    return [`${fileName}: the front matter is never closed with ---`];
  }

  const errors = [];
  const entries = lines
    .slice(1, closingFence)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (entries.length === 0) {
    errors.push(`${fileName}: the front matter declares no project bumps`);
  }

  for (const entry of entries) {
    const match = /^(?<key>.+?)\s*:\s*(?<bump>\S+)$/u.exec(entry);
    if (!match) {
      errors.push(
        `${fileName}: "${entry}" is not a "<project name>": <bump> entry`,
      );
      continue;
    }

    const project = match.groups.key.replace(/^"|"$/gu, "");
    if (!knownProjects.has(project)) {
      errors.push(`${fileName}: ${project} is not a workspace package`);
    }
    const { bump } = match.groups;
    if (!RELEASE_TYPES.has(bump) && !RELEASE_TYPE_ALIASES.has(bump)) {
      errors.push(
        `${fileName}: ${bump} is not a release type nx accepts for ${project}`,
      );
    }
  }

  if (
    lines
      .slice(closingFence + 1)
      .join("\n")
      .trim() === ""
  ) {
    errors.push(
      `${fileName}: add a changelog message after the front matter; nx rejects a plan without one`,
    );
  }

  return errors;
}

export function verifyVersionPlans(
  repoRoot = process.cwd(),
  { requirePlans = false } = {},
) {
  const plansRoot = path.join(repoRoot, VERSION_PLANS_DIRECTORY);
  const planFiles = existsSync(plansRoot)
    ? readdirSync(plansRoot)
        .filter((file) => file.endsWith(".md"))
        .sort()
    : [];
  const knownProjects = readWorkspacePackageNames(repoRoot);
  const failures = [];
  const plans = planFiles.map((planFile) => ({
    file: planFile,
    content: readFileSync(path.join(plansRoot, planFile), "utf8"),
  }));

  for (const plan of plans) {
    failures.push(
      ...validateVersionPlan(plan.file, plan.content, knownProjects),
    );
  }
  failures.push(...validateQaChangelogCoverage(repoRoot, plans));
  if (requirePlans && planFiles.length === 0) {
    failures.push("at least one version plan file is required");
  }

  if (failures.length > 0) {
    throw new Error(`version plan hygiene failed:\n- ${failures.join("\n- ")}`);
  }
  return planFiles.length;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--version-plans-only")) {
    const plans = verifyVersionPlans(process.cwd(), { requirePlans: true });
    process.stdout.write(`version plans: verified ${plans} plan file(s)\n`);
  } else {
    const verified = verifyPublishablePlugins();
    const plans = verifyVersionPlans(process.cwd());
    process.stdout.write(
      `package hygiene: verified ${verified} publishable plugins\n`,
    );
    process.stdout.write(
      `package hygiene: verified ${plans} version plan file(s)\n`,
    );
  }
}
