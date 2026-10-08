import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPluginEntries,
  findManifestDrift,
  findManifestSchemaErrors,
  findReadmeDrift,
} from "./generate-plugins-manifest.mjs";

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
const CANONICAL_REGISTRY = "https://registry.npmjs.org/";
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
// A plugin registers its configuration card under one of these client slots,
// and the registration must stay guarded by the shared verification contract.
// The Host renamed the card slot to `plugins.row.config` in `0.1.7`, so the
// gate reads every name a card registration can arrive under — keying it on
// one literal made enforcement quietly disappear the moment that literal left
// the sources. The name says what it decides (this package owns a card), not
// what the contract then asks of it: on the panel seats the card contract
// forbids our own shell, because the page draws it, while a settings-surface
// card must carry it. `settings.plugins.tab` is also the slot of feature-owned
// pages that render no card at all, so it only counts with the shell the
// contract asserts (see `findSettingsCardSlot`).
const CARD_SEAT_SLOTS = [
  "settings.plugin.item",
  "plugins.row.config",
  "plugins.bundle.config",
];
const CARD_TAB_SLOT = "settings.plugins.tab";
const CARD_SHELL_MARKERS = [
  "dsh-plugin-card",
  "CardShell",
  "PLUGIN_CARD_SHELL_CSS",
  "registerSettingsCard",
];
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

/** End of one balanced object literal, ignoring quoted braces. */
function objectEnd(source, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return -1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2);
      if (index === -1) return -1;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/") {
      // Verification manifests commonly carry RegExp literals in
      // `legacyPatterns`; braces inside them are pattern text, not objects.
      quote = "/";
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/** A real `clientBundle.cardContract` inside a `runVerifyPackage({...})` call. */
function runnerUsesCardContract(source) {
  for (const call of source.matchAll(/\brunVerifyPackage\s*\(/gu)) {
    const callStart = (call.index ?? 0) + call[0].length;
    const optionsStart = source.indexOf("{", callStart);
    if (optionsStart === -1) continue;
    const optionsEnd = objectEnd(source, optionsStart);
    if (optionsEnd === -1) continue;
    const options = source.slice(optionsStart, optionsEnd);
    for (const clientBundle of options.matchAll(/\bclientBundle\s*:\s*\{/gu)) {
      const bundleStart =
        (clientBundle.index ?? 0) + clientBundle[0].length - 1;
      const bundleEnd = objectEnd(options, bundleStart);
      if (bundleEnd === -1) continue;
      const bundle = options.slice(bundleStart, bundleEnd);
      if (/\bcardContract\s*:/u.test(bundle)) return true;
    }
  }
  return false;
}

const REQUIRED_PLUGIN_SCRIPTS = [
  "lint",
  "typecheck",
  "build",
  "verify:package",
  "verify",
  "check",
  "prepack",
];

// A publishable shared package is not a Cordis bundle, so it owes the reduced
// gate `run-verify-package` implements rather than the plugin contract above:
// without a `verify` script nothing asks whether its declared exports were
// built or whether its published ranges resolve, which is how the class of
// "declared subpath with no file" reached a published library.
const REQUIRED_SHARED_PACKAGE_SCRIPTS = ["verify"];

// The two options a shared gate has to keep turning on. Packing rewrites the
// ranges and ships whatever `exports` names, so only a source-level read sees
// either; `docs/VERIFICATION.md` promises both, and an option a refactor drops
// would quietly narrow the gate while its script still exited 0.
const REQUIRED_SHARED_GATE_OPTIONS = [
  "mainTypesMatchRootExport",
  "publishedDependenciesResolve",
];

/** Names of `REQUIRED_SHARED_GATE_OPTIONS` a `runVerifyPackage({...})` call turns on. */
function sharedGateOptions(source) {
  const enabled = new Set();
  for (const call of source.matchAll(/\brunVerifyPackage\s*\(/gu)) {
    const callStart = (call.index ?? 0) + call[0].length;
    const optionsStart = source.indexOf("{", callStart);
    if (optionsStart === -1) continue;
    const optionsEnd = objectEnd(source, optionsStart);
    if (optionsEnd === -1) continue;
    const options = source.slice(optionsStart, optionsEnd);
    for (const name of REQUIRED_SHARED_GATE_OPTIONS) {
      if (new RegExp(`\\b${name}\\s*:\\s*true\\b`, "u").test(options)) {
        enabled.add(name);
      }
    }
  }
  return enabled;
}

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

  // The Host titles and describes the bundle's row on the Plugins panel from
  // `<package name>/locale/en.json`, which it resolves through the exports map
  // without activating the plugin. Skip the file and the row is named by its
  // full package specifier — an operator reads an identifier, not a name — and a
  // locale field that is empty or not a string is not a fallback but a metadata
  // diagnostic, which degrades the row the same way.
  const localePath = path.join(directory, "locale", "en.json");
  if (!existsSync(localePath)) {
    errors.push(
      "locale/en.json is missing; without it the Plugins panel names this row by its package specifier",
    );
  } else {
    let locale;
    try {
      locale = readJson(localePath);
    } catch (cause) {
      errors.push(`locale/en.json is not readable JSON: ${String(cause)}`);
    }
    for (const field of ["title", "description"]) {
      const value = locale?.meta?.[field];
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(`locale/en.json meta.${field} must be a non-empty string`);
      }
    }
  }
  if (manifest.exports?.["./locale/en.json"] !== "./locale/en.json") {
    errors.push(
      'exports["./locale/en.json"] must equal "./locale/en.json"; the Host reads the row name through the exports map',
    );
  }
  if (!isPublishedFile(manifest.files ?? [], "locale/en.json")) {
    errors.push("locale/en.json is missing from package.json files");
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

/**
 * A publishable shared package keeps a gate of its own, so Nx and CI run its
 * export and dependency checks instead of skipping the project silently.
 */
export function validatePublishableSharedPackage(directory) {
  const scripts = readJson(path.join(directory, "package.json")).scripts ?? {};
  const errors = [];
  for (const name of REQUIRED_SHARED_PACKAGE_SCRIPTS) {
    if (typeof scripts[name] !== "string") {
      errors.push(
        `scripts.${name} is required for every publishable shared package`,
      );
    }
  }

  // The manifest alone would accept a `verify` that checks nothing: a script
  // exiting 0 while `docs/VERIFICATION.md` describes the two checks it stopped
  // making. A package with no `verify` at all is reported once, above.
  const scriptsDirectory = path.join(directory, "scripts");
  if (typeof scripts.verify === "string") {
    const enabled = new Set();
    const gateFiles = existsSync(scriptsDirectory)
      ? readdirSync(scriptsDirectory, { withFileTypes: true })
      : [];
    for (const entry of gateFiles) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
      const source = readFileSync(
        path.join(scriptsDirectory, entry.name),
        "utf8",
      );
      for (const name of sharedGateOptions(source)) enabled.add(name);
    }
    const missing = REQUIRED_SHARED_GATE_OPTIONS.filter(
      (name) => !enabled.has(name),
    );
    if (missing.length > 0) {
      errors.push(
        `no script under scripts/ calls runVerifyPackage with ${missing.join(" and ")} enabled; ` +
          "a shared package gate keeps both options on — packing cannot show either",
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
    // One pass: chained replaces would rewrite the `*` inside the group they
    // just inserted, and `**/` would stop covering more than one directory.
    // `**/` also matches no directory at all, so `lib/**/*.js` covers `lib/a.js`.
    .replace(/\*\*\/|\*\*|\*/gu, (token) => {
      if (token === "**/") return "(?:.*/)?";
      if (token === "**") return ".*";
      return "[^/]*";
    });
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

  // A scoped package defaults to restricted access, and publishing a
  // restricted one needs a paid npm plan: the register answers 402 and the
  // release stops after the tarball is already built. The access level is
  // therefore part of the publishable contract, not an operator preference.
  const publishConfig = manifest.publishConfig;
  if (publishConfig?.access !== "public") {
    errors.push(
      'publishConfig.access must be "public" so a scoped package publishes on the free plan',
    );
  }
  if (publishConfig?.registry !== CANONICAL_REGISTRY) {
    errors.push(`publishConfig.registry must be "${CANONICAL_REGISTRY}"`);
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

/**
 * The root README is the human entry point to the published set, so its package
 * table is a second catalog beside `plugins.json`: a package missing from it is
 * invisible to a reader who never opens the JSON, and a row that still calls a
 * published package "private" misstates which npm names are published, and so
 * installable at all. The gate keeps both catalogs listing the same package set.
 */
export function findReadmeCatalogGaps(repoRoot = process.cwd()) {
  const readmePath = path.join(repoRoot, "README.md");
  if (!existsSync(readmePath)) {
    return ["README.md is missing; it must list every publishable package"];
  }
  const readme = readFileSync(readmePath, "utf8");
  return collectPluginEntries(repoRoot)
    .filter((entry) => !readme.includes(`\`${entry.npm}\``))
    .map(
      (entry) =>
        `${entry.npm} is missing from the root README package table (${entry.path})`,
    );
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
        ...(group === "packages"
          ? validatePublishableSharedPackage(directory)
          : []),
        ...validateDiscoverability(directory, repoRoot),
        ...validatePublishedContent(directory, repoRoot),
      ];
      for (const error of errors) {
        failures.push(`${manifest.name}: ${error}`);
      }
    }
  }

  const catalogErrors = [
    ...findManifestDrift(repoRoot),
    ...findReadmeDrift(repoRoot),
    ...findManifestSchemaErrors(repoRoot),
  ];
  for (const error of catalogErrors) {
    failures.push(`catalog: ${error}`);
  }

  for (const error of findReadmeCatalogGaps(repoRoot)) {
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

/**
 * The two changelog baselines the frozen-section gate needs: as the newest
 * reachable `release/*` tag published it, and as the branch's own merge base
 * with that tag saw it. Returns null when there is nothing to freeze against —
 * no wave tag yet, a shallow clone without tags, or a checkout where the file
 * is missing at the tag — so the gate skips instead of inventing a baseline.
 */
export function qaChangelogBaselines(repoRoot) {
  const git = (args) =>
    spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  const gitPath = path
    .join(QA_SURFACE_DIRECTORY, QA_CHANGELOG_SOURCE)
    .split(path.sep)
    .join("/");
  const describe = git([
    "describe",
    "--tags",
    "--match",
    "release/*",
    "--abbrev=0",
    "HEAD",
  ]);
  if (describe.status !== 0) return null;
  const tag = describe.stdout.trim();
  if (tag === "") return null;
  const released = git(["show", `${tag}:${gitPath}`]);
  if (released.status !== 0) return null;
  const mergeBase = git(["merge-base", tag, "HEAD"]);
  if (mergeBase.status !== 0) {
    return { released: released.stdout, base: released.stdout };
  }
  const base = git(["show", `${mergeBase.stdout.trim()}:${gitPath}`]);
  // No file at the merge base means this branch wrote the whole changelog, so
  // every published section is its own doing.
  return {
    released: released.stdout,
    base: base.status === 0 ? base.stdout : null,
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
export function validateQaChangelogCoverage(repoRoot, plans) {
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

/**
 * The client slot a package mounts its configuration card under, or `null` when
 * its sources register no card. A slot only a card can be seated on fires on its
 * own — the panel seats included, whose contract is that the bundle carries *no*
 * shell of ours; `settings.plugins.tab` fires only together with the shell, because
 * that slot also carries feature-owned pages that render no card and would be asked
 * to assert a shell they never claim.
 */
function findSettingsCardSlot(sources) {
  const texts = walkFiles(sources).map((file) => readFileSync(file, "utf8"));
  const mentions = (needle) => texts.some((text) => text.includes(needle));
  const cardSlot = CARD_SEAT_SLOTS.find(mentions);
  if (cardSlot !== undefined) return cardSlot;
  return mentions(CARD_TAB_SLOT) && CARD_SHELL_MARKERS.some(mentions)
    ? CARD_TAB_SLOT
    : null;
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
    // escapes dropped before looking for the full package name. A bare
    // mention of the name is not enough — a `manifest.name` equality check
    // would satisfy it — so the same script must also pin the ModuleLoader
    // registration: either the shared runner's `moduleLoaderId` option or an
    // assertion against `window.__ModuleLoader__` itself.
    const asserted = walkFiles(scripts)
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => readFileSync(file, "utf8"))
      .some((content) => {
        const normalized = content.replaceAll("\\", "");
        return (
          normalized.includes(`@yadsh/${directoryName}`) &&
          /__ModuleLoader__|moduleLoaderId/u.test(normalized)
        );
      });
    if (!asserted) {
      errors.push(
        `dsh.client is declared, but no scripts/*.mjs asserts the ModuleLoader registration id "@yadsh/${directoryName}"; pass clientBundle.moduleLoaderId to runVerifyPackage or assert window.__ModuleLoader__.load in verify-package.mjs or verify-client-bundle.mjs`,
      );
    }
  }

  const cardSlot = findSettingsCardSlot(sources);
  if (cardSlot !== null) {
    // The shared runner takes the contract as an option, so a manifest that
    // passes `clientBundle.cardContract` runs the same gate without importing
    // the module by path.
    const routed =
      anyScriptMentions(scripts, CARD_CONTRACT_MODULE) ||
      walkFiles(scripts)
        .filter((file) => file.endsWith(".mjs"))
        .map((file) => readFileSync(file, "utf8"))
        .some(runnerUsesCardContract);
    if (!routed) {
      errors.push(
        `src registers a "${cardSlot}" card, but no script in scripts/ runs ${CARD_CONTRACT_MODULE}.mjs; call it from verify-package.mjs or verify-client-bundle.mjs, or pass clientBundle.cardContract to runVerifyPackage`,
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
  { requirePlans = false, changelogBaselines } = {},
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

  const changelogPath = path.join(
    repoRoot,
    QA_SURFACE_DIRECTORY,
    QA_CHANGELOG_SOURCE,
  );
  const manifestPath = path.join(
    repoRoot,
    QA_SURFACE_DIRECTORY,
    "package.json",
  );
  if (existsSync(changelogPath) && existsSync(manifestPath)) {
    const changelogSource = readFileSync(changelogPath, "utf8");
    const baselines =
      changelogBaselines === undefined
        ? qaChangelogBaselines(repoRoot)
        : changelogBaselines;
    const baseSource =
      baselines === null || baselines === undefined ? null : baselines.base;
    failures.push(
      ...validateQaChangelogPlannedEntries(
        changelogSource,
        readJson(manifestPath).version,
        plans,
        baseSource,
      ),
    );
    if (baselines !== null && baselines !== undefined) {
      failures.push(
        ...validateQaChangelogFrozenSections(
          changelogSource,
          baselines.released,
          baselines.base,
        ),
      );
    }
  }

  if (requirePlans && planFiles.length === 0) {
    failures.push("at least one version plan file is required");
  }

  if (failures.length > 0) {
    throw new Error(`version plan hygiene failed:\n- ${failures.join("\n- ")}`);
  }
  return planFiles.length;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const plansOnly = process.argv.includes("--version-plans-only");
  // Read the frozen baseline once and say out loud when there is none, so a
  // skipped check is never mistaken for a passing one.
  const changelogBaselines = qaChangelogBaselines(process.cwd());
  if (changelogBaselines === null) {
    process.stderr.write(
      "package hygiene: frozen changelog sections NOT checked, no release/* tag reachable from HEAD\n",
    );
  }
  if (plansOnly) {
    const plans = verifyVersionPlans(process.cwd(), {
      requirePlans: true,
      changelogBaselines,
    });
    process.stdout.write(`version plans: verified ${plans} plan file(s)\n`);
  } else {
    const verified = verifyPublishablePlugins();
    const plans = verifyVersionPlans(process.cwd(), { changelogBaselines });
    process.stdout.write(
      `package hygiene: verified ${verified} publishable plugins\n`,
    );
    process.stdout.write(
      `package hygiene: verified ${plans} version plan file(s)\n`,
    );
  }
}
