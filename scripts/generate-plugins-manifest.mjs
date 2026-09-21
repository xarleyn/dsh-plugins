import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "./json-schema-validate.mjs";

/**
 * The repository publishes one npm package per `plugins/` (and public
 * `packages/`) directory, which is invisible to crawlers that only read a
 * single package manifest. `plugins.json` is the machine-readable catalog that
 * maps every published package to its monorepo directory so DSH directories,
 * marketplace indexers, and RAG crawlers do not have to guess.
 *
 * The README package table is the human-readable half of the same catalog. Both
 * halves are generated from the workspace manifests here, and private build
 * tooling is kept in the README table while staying out of `plugins.json`.
 */
export const MANIFEST_FILE = "plugins.json";
export const MANIFEST_GENERATOR = "scripts/generate-plugins-manifest.mjs";
export const REPOSITORY_URL = "https://github.com/xarleyn/dsh-plugins";
export const GITHUB_TOPIC = "dsh-plugin";
export const PACKAGE_GROUPS = ["plugins", "packages"];
export const README_FILE = "README.md";
export const SCHEMA_FILE = "docs/plugins.schema.json";
export const PRIVATE_PACKAGE_LABEL = "private workspace package";
export const CATALOG_HEADER = "| Directory | npm package | Purpose |";
export const CATALOG_SEPARATOR = "| --- | --- | --- |";

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

/**
 * Returns the schema errors of a manifest object, prefixed for gate output.
 * `docs/plugins.schema.json` is the single description of the catalog shape, so
 * both the generator (before writing) and the hygiene gate (on the committed
 * file) report the same wording.
 */
export function schemaErrorsFor(manifest, schema) {
  return validateAgainstSchema(manifest, schema).map(
    (error) => `${MANIFEST_FILE} does not match ${SCHEMA_FILE}: ${error}`,
  );
}

/**
 * Returns the errors that make the committed manifest structurally wrong, such
 * as a missing key, a wrong type, or an unknown property. Freshness is checked
 * separately by `findManifestDrift`; this validates the shape itself against
 * `docs/plugins.schema.json`.
 */
export function findManifestSchemaErrors(repoRoot = process.cwd()) {
  const manifestPath = path.join(repoRoot, MANIFEST_FILE);
  const schemaPath = path.join(repoRoot, SCHEMA_FILE);
  if (!existsSync(schemaPath)) return [`${SCHEMA_FILE} is missing`];
  if (!existsSync(manifestPath)) {
    return [`${MANIFEST_FILE} is missing; run "pnpm plugins:manifest"`];
  }

  let manifest;
  let schema;
  try {
    schema = readJson(schemaPath);
  } catch (error) {
    return [`${SCHEMA_FILE} is not valid JSON: ${error.message}`];
  }
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return [`${MANIFEST_FILE} is not valid JSON: ${error.message}`];
  }

  return schemaErrorsFor(manifest, schema);
}

/**
 * Collects every workspace package directory in a deterministic order,
 * including private build tooling. The manifest skips private packages; the
 * README table keeps them so the repository layout stays fully documented.
 * Groups keep the order of `PACKAGE_GROUPS`, directories sort within a group.
 */
export function collectCatalogEntries(repoRoot = process.cwd()) {
  const entries = [];
  for (const group of PACKAGE_GROUPS) {
    const groupRoot = path.join(repoRoot, group);
    if (!existsSync(groupRoot)) continue;
    const groupEntries = [];
    for (const dirent of readdirSync(groupRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const manifestPath = path.join(groupRoot, dirent.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      groupEntries.push({
        path: `${group}/${dirent.name}`,
        npm: manifest.private === true ? null : manifest.name,
        description: manifest.description ?? "",
      });
    }
    groupEntries.sort((left, right) => left.path.localeCompare(right.path));
    entries.push(...groupEntries);
  }
  return entries;
}

function tableCell(value) {
  return value.replaceAll("|", "\\|").replaceAll(/\s+/gu, " ").trim();
}

export function renderCatalogTable(entries) {
  const rows = entries.map((entry) => [
    `\`${entry.path}\``,
    entry.npm === null ? PRIVATE_PACKAGE_LABEL : `\`${entry.npm}\``,
    tableCell(entry.description),
  ]);
  return [
    CATALOG_HEADER,
    CATALOG_SEPARATOR,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function catalogTableRange(lines) {
  const start = lines.indexOf(CATALOG_HEADER);
  if (start === -1 || lines[start + 1] !== CATALOG_SEPARATOR) return null;
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith("|")) end += 1;
  return { start, end };
}

/**
 * Returns `readme` with its package catalog table replaced by the current
 * workspace contents, or null when the table is missing.
 */
export function renderReadmeCatalog(readme, entries) {
  const lines = readme.split("\n");
  const range = catalogTableRange(lines);
  if (range === null) return null;
  return [
    ...lines.slice(0, range.start),
    ...renderCatalogTable(entries).split("\n"),
    ...lines.slice(range.end),
  ].join("\n");
}

/**
 * Returns the README catalog drift errors. Prose around the table is ignored;
 * the header, the entry order, and every row are compared.
 */
export function findReadmeDrift(repoRoot = process.cwd()) {
  const readmePath = path.join(repoRoot, README_FILE);
  if (!existsSync(readmePath)) return [`${README_FILE} is missing`];

  const readme = readFileSync(readmePath, "utf8");
  const expected = renderReadmeCatalog(readme, collectCatalogEntries(repoRoot));
  if (expected === null) {
    return [
      `${README_FILE} is missing the ${JSON.stringify(CATALOG_HEADER)} ` +
        `package table followed by ${JSON.stringify(CATALOG_SEPARATOR)}`,
    ];
  }
  if (expected !== readme) {
    return [
      `${README_FILE} package catalog is out of date with the workspace ` +
        'manifests; run "pnpm plugins:manifest"',
    ];
  }
  return [];
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const repoRoot = process.cwd();
  if (process.argv.includes("--check")) {
    const errors = [
      ...findManifestDrift(repoRoot),
      ...findReadmeDrift(repoRoot),
      ...findManifestSchemaErrors(repoRoot),
    ];
    if (errors.length > 0) {
      process.stderr.write(`${errors.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `${MANIFEST_FILE} and ${README_FILE} catalogs: up to date and valid\n`,
    );
  } else {
    const manifest = buildManifest(repoRoot);
    const schemaPath = path.join(repoRoot, SCHEMA_FILE);
    const schemaErrors = existsSync(schemaPath)
      ? schemaErrorsFor(manifest, readJson(schemaPath))
      : [];
    if (schemaErrors.length > 0) {
      process.stderr.write(
        `${MANIFEST_FILE} was not written; the workspace manifests produce ` +
          `an invalid catalog:\n${schemaErrors.join("\n")}\n`,
      );
      process.exit(1);
    }
    writeFileSync(
      path.join(repoRoot, MANIFEST_FILE),
      serializeManifest(manifest),
    );
    process.stdout.write(
      `${MANIFEST_FILE}: wrote ${manifest.plugins.length} package(s)\n`,
    );

    const entries = collectCatalogEntries(repoRoot);
    const readmePath = path.join(repoRoot, README_FILE);
    const readme = existsSync(readmePath)
      ? readFileSync(readmePath, "utf8")
      : null;
    const updated =
      readme === null ? null : renderReadmeCatalog(readme, entries);
    if (updated === null) {
      process.stdout.write(`${README_FILE}: no package table, not updated\n`);
    } else if (updated === readme) {
      process.stdout.write(`${README_FILE}: catalog up to date\n`);
    } else {
      writeFileSync(readmePath, updated);
      process.stdout.write(
        `${README_FILE}: wrote ${entries.length} package(s)\n`,
      );
    }
  }
}
