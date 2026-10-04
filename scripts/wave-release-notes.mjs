import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readReleaseRows } from "./verify-package-publication.mjs";

const CHANGELOG_FILE = "CHANGELOG.md";

/**
 * The largest body the GitHub Releases API accepts. A wave that exceeds it fails
 * the release step with `422 body is too long` — after npm, the wave tag and the
 * push have already succeeded — so the limit is enforced here instead.
 */
const RELEASE_BODY_LIMIT = 125_000;

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

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Pack whole entries under the budget, dropping from the end rather than
 * cutting a paragraph, and name what was left out together with where its text
 * still lives. An entry too large on its own is trimmed at a line boundary —
 * never to nothing, because a release whose body is only an apology is worse
 * than a shortened one.
 */
export function packWaveNotes(entries, budget) {
  const footerFor = (omitted) =>
    omitted.length === 0
      ? ""
      : `\n\n_${omitted.length} entr${omitted.length === 1 ? "y" : "ies"} shortened to the index above because GitHub caps a release body at ${RELEASE_BODY_LIMIT} characters: ${omitted
          .map((item) => `\`${item.title}\` (\`${item.path}\`)`)
          .join(", ")}._\n`;
  const assemble = (included, omitted) =>
    `${included.map((item) => item.text).join("\n\n")}\n${footerFor(omitted)}`;

  if (entries.length === 0) return "";

  // Drop whole entries first: half a story would describe a release the wave did
  // not ship, while the index above still names the package and its file.
  for (let kept = entries.length; kept > 1; kept -= 1) {
    const text = assemble(entries.slice(0, kept), entries.slice(kept));
    if (text.length <= budget) return text;
  }

  // A single entry that still does not fit is trimmed line by line, and the
  // footer is kept: it is what tells the reader where the shortened text lives.
  const footer = footerFor(entries.slice(1));
  const marker = `\n\n_(trimmed: GitHub caps a release body at ${RELEASE_BODY_LIMIT} characters; the full entry is in the file named in the index.)_\n`;
  const room = Math.max(budget - footer.length - marker.length, 0);
  const lines = entries[0].text.split("\n");
  let keptLines = lines.length;
  while (keptLines > 1 && lines.slice(0, keptLines).join("\n").length > room) {
    keptLines -= 1;
  }

  return `${lines.slice(0, keptLines).join("\n")}${marker}${footer}`;
}

/**
 * The GitHub Release notes for one release wave: an index naming every released
 * package and where its changelog lives, then the changelog entry each new
 * version already carries in the repository. The release commit rewrote those
 * changelogs moments before, so the notes always describe exactly what the wave
 * published — and the index is what stays true when the body hits the limit.
 */
export function buildWaveNotes(rows, repoRoot, limit = RELEASE_BODY_LIMIT) {
  const index = rows
    .map(
      (row) =>
        `- \`${row.name}@${row.version}\` — \`${row.directory}/${CHANGELOG_FILE}\``,
    )
    .join("\n");
  const preamble = `## Packages in this release\n\n${index}\n\n`;

  const entries = rows.map((row) => {
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
    const title = `${row.name} ${row.version}`;

    return {
      title,
      path: `${row.directory}/${CHANGELOG_FILE}`,
      text: [
        `## ${title}`,
        "",
        body || "_No changelog entry was found for this version._",
      ].join("\n"),
    };
  });

  return `${preamble}${packWaveNotes(entries, limit - preamble.length)}`;
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
