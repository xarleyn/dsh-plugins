import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readReleaseRows } from "./verify-package-publication.mjs";

const CHANGELOG_FILE = "CHANGELOG.md";

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The body of a version's own section in an Nx-generated changelog, or
 * undefined when the changelog does not mention the version. A heading is
 * the version followed by a whitespace, an opening parenthesis, or the end
 * of the line, so `1.1.0` never matches a `1.1.01` heading.
 */
export function changelogSection(changelog, version) {
  const heading = new RegExp(
    `^##\\s+${escapeRegExp(version)}(?:\\s|\\(|$)`,
    "u",
  );
  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s/u.test(line),
  );
  const body = lines.slice(start + 1, end === -1 ? lines.length : end);
  while (body.length > 0 && body[0].trim() === "") body.shift();
  while (body.length > 0 && body.at(-1).trim() === "") body.pop();
  return body.join("\n");
}

/**
 * The GitHub Release notes for one release wave: every released package with
 * the changelog entry its new version already carries in the repository. The
 * release commit rewrote those changelogs moments before, so the notes always
 * describe exactly what the wave published.
 */
export function buildWaveNotes(rows, repoRoot) {
  const sections = [];

  for (const row of rows) {
    let changelog;
    try {
      changelog = readFileSync(
        path.join(repoRoot, row.directory, CHANGELOG_FILE),
        "utf8",
      );
    } catch {
      changelog = undefined;
    }
    const body = changelog
      ? changelogSection(changelog, row.version)
      : undefined;
    sections.push(
      [
        `## ${row.name} ${row.version}`,
        "",
        body || "_No changelog entry was found for this version._",
      ].join("\n"),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function main(argv = process.argv.slice(2)) {
  const option = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  try {
    const tsvFile = option("tsv");
    if (!tsvFile) throw new Error("--tsv=<release-packages.tsv> is required");
    process.stdout.write(
      buildWaveNotes(readReleaseRows(tsvFile), process.cwd()),
    );
    return 0;
  } catch (error) {
    process.stderr.write(
      `wave release notes: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main());
}
