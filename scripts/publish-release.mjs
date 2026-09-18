import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleaseRows } from "./verify-package-publication.mjs";

const REGISTRY = "https://registry.npmjs.org";
const ABBREVIATED_PACKUMENT = "application/vnd.npm.install-v1+json";
const WORKSPACE_GROUPS = ["plugins", "packages"];
// The fields npm resolves when a consumer installs the package. Peer ranges
// belong to the consumer's environment and dev ranges never install, so
// neither can make a published version uninstallable.
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies"];
const WORKSPACE_SCOPE = "@yadsh/";
const REPOSITORY = "xarleyn/dsh-plugins";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";

function write(line) {
  process.stdout.write(`${line}\n`);
}

function fail(line) {
  process.stderr.write(`${line}\n`);
}

/** Every manifest this workspace publishes, keyed by package name. */
export function workspaceManifests(root) {
  const manifests = new Map();

  for (const group of WORKSPACE_GROUPS) {
    const groupDirectory = path.join(root, group);
    if (!existsSync(groupDirectory)) continue;

    for (const entry of readdirSync(groupDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(
        groupDirectory,
        entry.name,
        "package.json",
      );
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifests.set(manifest.name, manifest);
    }
  }

  return manifests;
}

/**
 * The range a dependency is published with. pnpm rewrites the `workspace:`
 * protocol at pack time from the version the dependency has in the tree being
 * packed, so a release commit's bumped versions, not the repository's last
 * release, are what an installing consumer resolves against.
 */
export function publishedRange(range, dependencyVersion) {
  if (!range.startsWith("workspace:")) return range;

  const requested = range.slice("workspace:".length);
  if (requested === "*") return dependencyVersion;
  if (requested === "^" || requested === "~") {
    return `${requested}${dependencyVersion}`;
  }
  if (requested === "") {
    throw new Error(`"${range}" names no version for a published dependency`);
  }
  return requested;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return undefined;

  return {
    numbers: [match[1], match[2], match[3]].map(Number),
    prerelease: match[4] ?? "",
  };
}

/** The semver ordering rule, prereleases included: -1, 0 or 1. */
function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index] ? -1 : 1;
    }
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === "") return 1;
  if (right.prerelease === "") return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** The exclusive upper bound `^` and `~` imply for a version. */
function upperBound(operator, [major, minor, patch]) {
  if (operator === "~") {
    return major === 0 && minor === 0
      ? `<0.0.${patch + 1}`
      : `<${major}.${minor + 1}.0`;
  }
  if (major > 0) return `<${major + 1}.0.0`;
  if (minor > 0) return `<0.${minor + 1}.0`;
  return `<0.0.${patch + 1}`;
}

const WILDCARD = /^([xX*]|\*\.\*\.\*)$/u;

/**
 * Whether a version satisfies a range, for the forms a released workspace
 * produces: `workspace:`-derived carets and tildes, exact versions, stars and
 * comparator lists. Anything outside that algebra is refused instead of
 * guessed, so a manifest that needs more is reported rather than misread; the
 * install check on the published version is the second opinion.
 */
export function satisfiesRange(version, range) {
  const candidate = parseVersion(version);
  if (!candidate) {
    throw new Error(`"${version}" is not a version this gate reads`);
  }

  const comparators = range.trim().split(/\s+/u).filter(Boolean);
  if (comparators.length === 0) {
    throw new Error(`"${range}" is not a range this gate reads`);
  }
  if (WILDCARD.test(range.trim())) return true;

  return comparators.every((comparator) => {
    const [, operator, bound] =
      /^(\^|~|>=|<=|>|<|=)?(.+)$/u.exec(comparator) ?? [];
    const target = parseVersion(bound ?? "");
    if (!target) {
      throw new Error(
        `"${comparator}" in "${range}" is not a comparator this gate reads`,
      );
    }
    // A prerelease only satisfies a range that asks for one, which is what
    // keeps `^0.3.0` from accepting `0.3.0-rc.1`.
    if (
      candidate.prerelease !== "" &&
      target.prerelease === "" &&
      candidate.numbers.join(".") === target.numbers.join(".")
    ) {
      return false;
    }

    const difference = compareVersions(candidate, target);
    switch (operator) {
      case "^":
      case "~":
        return difference >= 0
          ? satisfiesRange(version, upperBound(operator, target.numbers))
          : false;
      case ">=":
        return difference >= 0;
      case ">":
        return difference > 0;
      case "<=":
        return difference <= 0;
      case "<":
        return difference < 0;
      default:
        return difference === 0;
    }
  });
}

/** Which wave rows a wave row needs, and which rows need it. */
export function releaseEdges(rows, manifests) {
  const wave = new Set(rows.map((row) => row.name));
  const requires = new Map(rows.map((row) => [row.name, []]));
  const dependents = new Map(rows.map((row) => [row.name, []]));

  for (const row of rows) {
    const manifest = manifests.get(row.name) ?? {};
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (!wave.has(name) || name === row.name) continue;
        requires.get(row.name).push(name);
        dependents.get(name).push(row.name);
      }
    }
  }

  return { requires, dependents };
}

/** Rows ordered so that a dependency is published before its dependents. */
export function publishOrder(rows, { requires } = {}) {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const needed = requires ?? releaseEdges(rows, new Map()).requires;

  const order = [];
  const remaining = new Set(byName.keys());
  while (remaining.size > 0) {
    // Sorted, so a wave published twice keeps one order and a rerun's log
    // lines up with the run it resumes.
    const ready = [...remaining]
      .filter((name) =>
        needed.get(name).every((dependency) => !remaining.has(dependency)),
      )
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `the release contains a dependency cycle: ${[...remaining].sort().join(", ")}`,
      );
    }
    for (const name of ready) {
      order.push(byName.get(name));
      remaining.delete(name);
    }
  }

  return order;
}

/** Registry versions of a package; an unknown name is an empty list. */
export async function registryVersions(name, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${REGISTRY}/${name.replace("/", "%2F")}`, {
    // The release asks about a handful of packages and is done, so a socket
    // kept alive past the last answer is a process that cannot exit cleanly.
    headers: { accept: ABBREVIATED_PACKUMENT, connection: "close" },
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(
      `the npm registry answered ${response.status} for ${name}; the release's dependencies cannot be checked`,
    );
  }

  const document = await response.json();
  return Object.keys(document.versions ?? {});
}

/**
 * What each wave package's dependencies resolve to once pnpm has rewritten the
 * workspace protocol. The ranges npm must satisfy are reported here, before a
 * single tarball is uploaded: a wave that cannot install is cheaper to refuse
 * than to publish.
 */
export async function inspectWave(
  rows,
  { manifests, lookup = registryVersions } = {},
) {
  const waveVersions = new Map(rows.map((row) => [row.name, row.version]));
  const failures = [];
  const registry = new Map();

  for (const row of rows) {
    const manifest = manifests.get(row.name);
    if (!manifest) {
      failures.push({
        row,
        reason: `the workspace has no manifest for ${row.name}`,
      });
      continue;
    }

    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, declared] of Object.entries(manifest[field] ?? {})) {
        // Only the workspace protocol is resolved here. A `catalog:` range is
        // pnpm's to expand at pack time, and the packed manifest is where
        // scripts/tarball-verify.sh gate 6 reads what actually left the
        // workspace; expanding it twice would let the two answers disagree.
        if (
          !declared.startsWith("workspace:") ||
          !name.startsWith(WORKSPACE_SCOPE)
        ) {
          continue;
        }

        let range;
        try {
          const version =
            waveVersions.get(name) ?? manifests.get(name)?.version;
          if (version === undefined) {
            throw new Error(
              `the workspace has no version for ${name}, so "${declared}" has nothing to resolve to`,
            );
          }
          range = publishedRange(declared, version);
        } catch (error) {
          failures.push({
            row,
            dependency: name,
            detail: declared,
            reason: error.message,
          });
          continue;
        }

        if (waveVersions.has(name)) {
          if (!satisfiesRange(waveVersions.get(name), range)) {
            failures.push({
              row,
              dependency: name,
              detail: declared,
              reason: `this release publishes ${name}@${waveVersions.get(name)}, which ${range} does not accept`,
            });
          }
          continue;
        }

        if (!registry.has(name)) {
          registry.set(name, await lookup(name));
        }
        if (
          !registry.get(name).some((version) => satisfiesRange(version, range))
        ) {
          failures.push({
            row,
            dependency: name,
            detail: declared,
            reason: `neither this release nor npm has a version ${range} accepts`,
          });
        }
      }
    }
  }

  return { failures };
}

/**
 * The npm a release publishes with: the one on PATH, which the publish job
 * upgrades to the version trusted publishing needs. Windows resolves `npm` to
 * a shim that cannot be spawned without a shell, so the CLI file runs through
 * node there instead - the release itself only ever runs on Linux.
 */
function npmInvocation() {
  if (process.platform !== "win32") return { command: "npm", prefix: [] };

  return {
    command: process.execPath,
    prefix: [
      path.join(
        path.dirname(process.execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    ],
  };
}

/** The npm invocation a wave package is published with. */
export function publishArguments(tarballPath, { dryRun = false } = {}) {
  return [
    "publish",
    tarballPath,
    "--access",
    "public",
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

function runNpm(args, { cwd }) {
  const { command, prefix } = npmInvocation();
  const result = spawnSync(command, [...prefix, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    // A command that never started has no npm output of its own, and its
    // reason has to reach the operator instead of reading as a refusal.
    output: [
      result.stdout ?? "",
      result.stderr ?? "",
      result.error ? `${result.error.message}\n` : "",
    ].join(""),
  };
}

const PUBLISH_REFUSAL =
  /E404|404 Not Found|E403|EOTP|could not be found or you do not have permission/iu;

/**
 * The failure that stops a release and cannot be worked out from the registry:
 * npm refuses a name the workflow is not a publisher of, answering the 404 an
 * unclaimed name gets. The message names the package settings instead of
 * leaving the operator with a status code.
 */
export function publishFailureMessage(name, version) {
  return [
    `npm refused to publish ${name}@${version}.`,
    "A package the workflow does not own answers 404 on publish, whatever the reason:",
    `  - register a Trusted Publisher for ${name} (repository ${REPOSITORY}, workflow ${RELEASE_WORKFLOW}), or`,
    "  - publish that tarball once by hand with a granular token that covers the name,",
    "then rerun the release. Versions npm already has are adopted, not republished.",
  ].join("\n");
}

/** npm's answer when the version is on the registry and cannot be published over. */
const DUPLICATE_VERSION =
  /EPUBLISHCONFLICT|cannot publish over|previously published version/iu;

export function adoptedAfterPublishMessage(name, version) {
  return [
    `npm already has ${name}@${version}, which this run did not publish.`,
    "The adoption check reads a cached registry document and can lag the publish that created the version, so the run continues: the registry keeps the version it has, and the tarball this run packed is not the one npm holds.",
  ].join("\n");
}

/**
 * Publishes the wave in dependency order. A package whose dependency was not
 * published is skipped rather than published broken, so the registry keeps a
 * set that installs, and a rerun resolves the same versions for whatever is
 * still missing. Versions npm already has are adopted, which is what lets a
 * rerun after a failure finish the wave instead of refusing it.
 */
export async function publishWave(
  order,
  { requires, dependents, isPublished, publish, onEvent = write },
) {
  // What npm has once this run is over, and what this run itself put there:
  // the first answers the dependency questions, the second is what the release
  // reports, and an adopted version belongs to neither the wave's tarballs nor
  // its count.
  const resolved = new Set();
  const published = [];
  const held = new Set();
  const adopted = [];
  const skipped = [];
  const failed = [];

  const skip = (name, reason) => {
    held.add(name);
    skipped.push({ name, reason });
  };

  const skipDependents = (name) => {
    for (const dependent of dependents.get(name) ?? []) {
      if (resolved.has(dependent) || held.has(dependent)) continue;
      // Named after the package it needs, so a skip reads as the dependency
      // chain that caused it rather than as one distant failure.
      const reason = `${name} was not published in this run`;
      skip(dependent, reason);
      onEvent(`Skipping ${dependent}: ${reason}`);
      skipDependents(dependent);
    }
  };

  for (const row of order) {
    const spec = `${row.name}@${row.version}`;
    // A dependency that failed already held this package back; the work is
    // done and the reason is recorded, so it is not decided twice.
    if (held.has(row.name)) continue;

    if (await isPublished(row)) {
      onEvent(`Adopting ${spec}: already published`);
      adopted.push(row);
      resolved.add(row.name);
      continue;
    }

    const missing = (requires.get(row.name) ?? []).filter(
      (dependency) => !resolved.has(dependency),
    );
    if (missing.length > 0) {
      const reason = `${missing.join(", ")} was not published in this run`;
      skip(row.name, reason);
      onEvent(`Skipping ${spec}: ${reason}`);
      skipDependents(row.name);
      continue;
    }

    if (!existsSync(row.tarballPath)) {
      fail(`Missing packed tarball: ${row.tarballPath}`);
      failed.push({ ...row, output: `no tarball at ${row.tarballPath}` });
      skipDependents(row.name);
      continue;
    }

    const result = await publish(row, row.tarballPath);
    if (result.output) process.stdout.write(result.output);
    if (result.ok) {
      onEvent(`Published ${spec}`);
      published.push(row);
      resolved.add(row.name);
      continue;
    }

    // npm refusing to publish over a version it has is npm stating the version
    // is there, without the cache the adoption check reads; the run adopts it
    // rather than failing a wave that has nothing left to do.
    if (DUPLICATE_VERSION.test(result.output)) {
      write(adoptedAfterPublishMessage(row.name, row.version));
      adopted.push(row);
      resolved.add(row.name);
      continue;
    }

    failed.push({ ...row, output: result.output });
    if (PUBLISH_REFUSAL.test(result.output)) {
      fail(publishFailureMessage(row.name, row.version));
    }
    skipDependents(row.name);
  }

  return { published, adopted, skipped, failed };
}

function runInstall(row) {
  const directory = mkdtempSync(path.join(tmpdir(), "dsh-install-check-"));
  try {
    // A DSH package's peers belong to the host application, and the harness
    // packages are not all on the public registry: resolving them would report
    // the host's absence instead of the release's own dependencies.
    return runNpm(
      [
        "install",
        `${row.name}@${row.version}`,
        "--dry-run",
        "--legacy-peer-deps",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefer-online",
      ],
      { cwd: directory },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The published rows a consumer cannot install, with npm's own answer. */
export async function verifyInstalls(
  rows,
  { install = runInstall, onEvent = write } = {},
) {
  const failures = [];

  for (const row of rows) {
    const result = await install(row);
    if (result.ok) {
      onEvent(`Installs ${row.name}@${row.version}`);
      continue;
    }
    failures.push({ ...row, output: result.output });
  }

  return failures;
}

function cliArguments(argv) {
  const option = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  return {
    modes: ["check", "publish", "verify-install"].filter((mode) =>
      argv.includes(`--${mode}`),
    ),
    tsvFile: option("tsv"),
    tarballs: option("tarballs"),
    root: option("root") ?? process.cwd(),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(argv = process.argv.slice(2)) {
  const { modes, tsvFile, tarballs, root, dryRun } = cliArguments(argv);

  if (modes.length !== 1) {
    fail(
      `Pass exactly one of --check, --publish or --verify-install (got ${modes.length}).`,
    );
    return 1;
  }
  if (!tsvFile) {
    fail("Pass --tsv=<file> as written by scripts/workspace-packages.mjs.");
    return 1;
  }

  const [mode] = modes;
  const rows = readReleaseRows(tsvFile);
  if (rows.length === 0) {
    write("release packages: nothing was selected");
    return 0;
  }
  const manifests = workspaceManifests(root);

  if (mode === "check") {
    const { failures } = await inspectWave(rows, { manifests });
    if (failures.length > 0) {
      fail(
        `release dependencies: ${failures.length} range(s) would not install`,
      );
      for (const item of failures) {
        const dependency = item.dependency
          ? ` -> ${item.dependency}${item.detail ? ` (${item.detail})` : ""}`
          : "";
        fail(
          `  ${item.row.name}@${item.row.version}${dependency}: ${item.reason}`,
        );
      }
      fail(
        "Add the missing package to the release with a version plan, or publish the missing version first.",
      );
      return 1;
    }
    write(
      `release dependencies: ${rows.length} package(s) resolve against the wave and the registry`,
    );
    return 0;
  }

  if (mode === "verify-install") {
    const failures = await verifyInstalls(rows);
    if (failures.length > 0) {
      fail(
        `install check: ${failures.length} published version(s) a consumer cannot install`,
      );
      for (const item of failures) {
        // npm answers with a code line first and the sentence that explains it
        // second, so the sentence is what an operator needs to see.
        const [, reason] =
          /npm error (?!code [A-Z]+$|A complete log)(.*)/mu.exec(item.output) ??
          [];
        const firstLine = item.output
          .split(/\r?\n/u)
          .find((line) => line.trim() !== "")
          ?.trim();
        fail(
          `  ${item.name}@${item.version}: ${(reason ?? firstLine ?? "npm refused the install").slice(0, 300)}`,
        );
      }
      fail(
        "The wave is on npm but is not installable; fix it and release again.",
      );
      return 1;
    }
    write(`install check: ${rows.length} published version(s) install`);
    return 0;
  }

  const { requires, dependents } = releaseEdges(rows, manifests);
  const order = publishOrder(rows, { requires }).map((row) => ({
    ...row,
    // Rows read back from the TSV carry a bare tarball name; the publish job
    // downloads them into one directory.
    tarballPath: path.join(tarballs ?? "", row.tarball),
  }));

  const result = await publishWave(order, {
    requires,
    dependents,
    isPublished: async (row) =>
      (await registryVersions(row.name)).includes(row.version),
    publish: (row, tarballPath) =>
      runNpm(publishArguments(tarballPath, { dryRun }), { cwd: root }),
  });

  const withVersion = result.published.length + result.adopted.length;
  write(
    [
      `release publish: ${result.published.length} published, ${result.adopted.length} adopted, ${result.skipped.length} skipped, ${result.failed.length} failed${dryRun ? " (dry run)" : ""}`,
      ...(result.skipped.length > 0
        ? ["A skipped package depends on one that did not publish."]
        : []),
      ...(withVersion === order.length
        ? []
        : [
            `${order.length - withVersion} of ${order.length} package(s) did not publish.`,
          ]),
    ].join("\n"),
  );

  if (result.failed.length > 0 || result.skipped.length > 0) {
    fail(
      `Failed to publish ${result.failed.length + result.skipped.length} package(s):`,
    );
    for (const item of result.failed) fail(`  ${item.name}@${item.version}`);
    for (const item of result.skipped) {
      fail(`  ${item.name}: skipped, ${item.reason}`);
    }
    fail("Nothing was pushed; fix the failures and rerun the release.");
    return 1;
  }

  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // The exit code is set rather than forced: process.exit() cuts the registry
  // responses' sockets out from under the loop, which aborts the process on
  // Windows before the last of the report is flushed.
  process.exitCode = await main().catch((error) => {
    fail(`release publish: ${error instanceof Error ? error.message : error}`);
    return 1;
  });
}
