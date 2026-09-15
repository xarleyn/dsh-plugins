import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REGISTRY = "https://registry.npmjs.org";
// The abbreviated packument keeps the probe to a few kilobytes; the same
// Accept header npm itself uses for install metadata.
const ABBREVIATED_PACKUMENT = "application/vnd.npm.install-v1+json";

/** Registry document URL for a package name, scoped names included. */
export function registryUrl(name) {
  return `${REGISTRY}/${name.replace("/", "%2F")}`;
}

async function packageExists(name, path, headers, fetchImpl) {
  const response = await fetchImpl(`${registryUrl(name)}${path}`, { headers });

  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(
    `the npm registry answered ${response.status} for ${name}; cannot tell whether the package exists`,
  );
}

/**
 * Trusted Publishing carries no package-creation authority: npm answers a first
 * publish from a workflow with a misleading 404, because a Trusted Publisher is
 * configured on a package that already exists. The registry therefore has to be
 * asked whether the name exists before the release attempts to publish it.
 */
export async function isPackagePublished(name, { fetchImpl = fetch } = {}) {
  if (
    await packageExists(name, "", { accept: ABBREVIATED_PACKUMENT }, fetchImpl)
  ) {
    return true;
  }

  // The abbreviated packument is served from a CDN cache, so a package
  // bootstrapped minutes ago can still answer 404 there. The version document
  // is a separate cache entry, and has to agree before the release is stopped.
  return packageExists(
    name,
    "/latest",
    { accept: "application/json" },
    fetchImpl,
  );
}

/** Packages among `packages` that the registry does not know yet. */
export async function findUnpublishedPackages(
  packages,
  { lookup = isPackagePublished } = {},
) {
  const unpublished = [];
  for (const item of packages) {
    if (!(await lookup(item.name))) unpublished.push(item);
  }
  return unpublished;
}

/** Release rows as written by `workspace-packages.mjs --format=tsv`. */
export function readReleaseRows(tsvFile) {
  return readFileSync(tsvFile, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [name, version, directory, tarball] = line.split("\t");
      return { name, version, directory, tarball };
    });
}

/**
 * The failure this gate exists for is a one-time, easily forgotten prerequisite,
 * so the message carries the whole recovery: publish one tarball by hand, then
 * register the publisher the workflow uses.
 */
export function unpublishedPackagesMessage(
  packages,
  {
    repository = "xarleyn/dsh-plugins",
    workflow = ".github/workflows/release.yml",
  } = {},
) {
  const listed = packages
    .map(
      (item) =>
        `  ${item.name}@${item.version}${item.tarball ? `  (${item.tarball})` : ""}`,
    )
    .join("\n");

  return [
    "npm cannot create a package name through Trusted Publishing, so these packages must be published once by hand before the workflow can release them:",
    listed,
    "",
    "Attach a granular access token or run `npm login`, then publish the tarball of this run (the `npm-tarballs` artifact):",
    "  npm publish ./<tarball>.tgz --access public",
    "",
    "Finally add this repository and workflow as the package's Trusted Publisher:",
    `  repository: ${repository}`,
    `  workflow:   ${workflow}`,
    "",
    "Nothing has been pushed and the version plans are still intact, so rerunning the Release workflow publishes every remaining version.",
  ].join("\n");
}

function cliArguments(argv) {
  const tsvArg = argv.find((arg) => arg.startsWith("--tsv="));
  const names = argv.filter((arg) => !arg.startsWith("-"));
  return { tsvFile: tsvArg?.slice("--tsv=".length), names };
}

/** `@scope/name@1.2.3` and bare `@scope/name` are both accepted on the CLI. */
export function parsePackageSpec(spec) {
  const separator = spec.lastIndexOf("@");
  if (separator <= 0) return { name: spec, version: "" };
  return { name: spec.slice(0, separator), version: spec.slice(separator + 1) };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { tsvFile, names } = cliArguments(process.argv.slice(2));
  if (!tsvFile && names.length === 0) {
    throw new Error(
      "Pass --tsv=<file> from the release workflow, or one or more package names to check.",
    );
  }

  const packages = tsvFile
    ? readReleaseRows(tsvFile)
    : names.map(parsePackageSpec);
  if (packages.length === 0) {
    throw new Error("No packages were selected for the publication check.");
  }

  const unpublished = await findUnpublishedPackages(packages);
  if (unpublished.length > 0) {
    process.stderr.write(`${unpublishedPackagesMessage(unpublished)}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `publication check: ${packages.length} package(s) already exist on npm\n`,
  );
}
