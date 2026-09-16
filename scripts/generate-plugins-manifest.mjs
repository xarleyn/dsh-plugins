import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository publishes one npm package per `plugins/` (and public
 * `packages/`) directory, which is invisible to crawlers that only read a
 * single package manifest. `plugins.json` is the machine-readable catalog that
 * maps every published package to its monorepo directory so DSH directories,
 * marketplace indexers, and RAG crawlers do not have to guess.
 */
export const MANIFEST_FILE = "plugins.json";
export const MANIFEST_GENERATOR = "scripts/generate-plugins-manifest.mjs";
export const REPOSITORY_URL = "https://github.com/xarleyn/dsh-plugins";
export const GITHUB_TOPIC = "dsh-plugin";
export const PACKAGE_GROUPS = ["plugins", "packages"];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function installCommand(npmName) {
  return `dsh plugin --profile <profile> add ${npmName}`;
}

/**
 * Collects every publishable workspace package in a deterministic order.
 * Private workspace packages are build tooling and are not catalogued.
 */
export function collectPluginEntries(repoRoot = process.cwd()) {
  const entries = [];
  for (const group of PACKAGE_GROUPS) {
    const groupRoot = path.join(repoRoot, group);
    if (!existsSync(groupRoot)) continue;
    for (const dirent of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const manifestPath = path.join(groupRoot, dirent.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      if (manifest.private === true) continue;
      entries.push({
        name: dirent.name,
        npm: manifest.name,
        path: `${group}/${dirent.name}`,
        description: manifest.description,
        keywords: manifest.keywords ?? [],
        install: installCommand(manifest.name),
        homepage: manifest.homepage,
        client: manifest.dsh?.client !== undefined,
      });
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export function buildManifest(repoRoot = process.cwd()) {
  return {
    $schema: "./docs/plugins.schema.json",
    generatedBy: MANIFEST_GENERATOR,
    repository: REPOSITORY_URL,
    githubTopic: GITHUB_TOPIC,
    plugins: collectPluginEntries(repoRoot),
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Returns the manifest drift errors. Formatting is ignored; entries, their
 * order, and the shared header fields are compared.
 */
export function findManifestDrift(repoRoot = process.cwd()) {
  const manifestPath = path.join(repoRoot, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return [`${MANIFEST_FILE} is missing; run "pnpm plugins:manifest"`];
  }

  let existing;
  try {
    existing = readJson(manifestPath);
  } catch (error) {
    return [`${MANIFEST_FILE} is not valid JSON: ${error.message}`];
  }

  const expected = buildManifest(repoRoot);
  const errors = [];
  for (const field of ["repository", "githubTopic"]) {
    if (existing[field] !== expected[field]) {
      errors.push(
        `${MANIFEST_FILE} ${field} must be ${JSON.stringify(expected[field])}`,
      );
    }
  }
  if (JSON.stringify(existing.plugins) !== JSON.stringify(expected.plugins)) {
    errors.push(
      `${MANIFEST_FILE} is out of date with the workspace manifests; ` +
        'run "pnpm plugins:manifest"',
    );
  }
  return errors;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const repoRoot = process.cwd();
  if (process.argv.includes("--check")) {
    const errors = findManifestDrift(repoRoot);
    if (errors.length > 0) {
      process.stderr.write(`${errors.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`${MANIFEST_FILE}: up to date\n`);
  } else {
    const manifest = buildManifest(repoRoot);
    writeFileSync(
      path.join(repoRoot, MANIFEST_FILE),
      serializeManifest(manifest),
    );
    process.stdout.write(
      `${MANIFEST_FILE}: wrote ${manifest.plugins.length} package(s)\n`,
    );
  }
}
