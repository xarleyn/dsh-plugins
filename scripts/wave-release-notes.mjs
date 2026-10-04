import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readReleaseRows } from "./verify-package-publication.mjs";

const CHANGELOG_FILE = "CHANGELOG.md";

/**
 * The largest body the GitHub Releases API accepts. A wave whose entries exceed
 * it fails the release step with `422 body is too long` after npm, the tag and
 * the push have already succeeded, so the limit is enforced here instead.
 */
const RELEASE_BODY_LIMIT = 125_000;

/**
 * Pack whole package sections into the limit, dropping from the end rather than
 * cutting a paragraph, and name what was left out. Only the single section that
 * does not fit on its own is trimmed, and then at a line boundary.
 */
export function capWaveNotes(sections, limit = RELEASE_BODY_LIMIT) {
  const heading = (section) => section.split("\n", 1)[0].replace(/^##\s+/u, "");
  const footerFor = (omitted) =>
    omitted.length === 0
      ? ""
      : `\n\n_${omitted.length} package section(s) left out because GitHub caps a ` +
        `release body at ${limit} characters: ${omitted.map((name) => `\`${name}\``).join(", ")}. ` +
        `Each one ships in its package's \`${CHANGELOG_FILE}\` and in the stand's version history._\n`;

  let kept = sections.length;
  let text = "";
  // Never drop below one section: a wave whose first entry alone exceeds the
  // limit is trimmed inside that entry rather than left with an empty body.
  while (kept >= 1) {
    const included = sections.slice(0, kept);
    const footer = footerFor(sections.slice(kept).map(heading));
    text = `${included.join("\n\n")}\n${footer}`;
    if (text.length <= limit || kept === 1) break;
    kept -= 1;
  }

  if (text.length > limit) {
    // The marker itself counts against the limit, or the trimmed body would
    // overshoot it by exactly the sentence that explains the overshoot.
    const marker = `\n\n_(trimmed: GitHub caps a release body at ${limit} characters.)_\n`;
    const lines = text.split("\n");
    while (lines.length > 1 && `${lines.join("\n")}${marker}`.length > limit) {
      lines.pop();
    }
    text = `${lines.join("\n")}${marker}`;
  }

  return text;
}

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

  return capWaveNotes(sections);
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
