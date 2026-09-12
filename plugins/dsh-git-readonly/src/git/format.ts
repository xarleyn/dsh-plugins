/**
 * Deterministic git output parsing.
 *
 * All metadata comes from explicit `--format` templates joined with the
 * ASCII unit separator (\x1f), never from parsing human-oriented output.
 * The final field of a template absorbs any separator characters that
 * appear inside it (e.g. newlines in a commit body).
 */

export const UNIT_SEP = '\x1f';

/** oid, shortOid, author, authoredAt (ISO), subject, decorations. */
export const HISTORY_FORMAT = ['%H', '%h', '%an', '%aI', '%s', '%d'].join(UNIT_SEP);

/** oid, shortOid, author, authoredAt (ISO), subject, parents, body. */
export const SHOW_META_FORMAT = ['%H', '%h', '%an', '%aI', '%s', '%P', '%b'].join(UNIT_SEP);

/**
 * Split one `--format` record. Fields before `fixedCount` must not contain
 * the separator; the last field is the remainder of the record.
 */
export function parseFormatRecord(record: string, fixedCount: number): string[] {
  const parts = record.split(UNIT_SEP);
  if (parts.length <= fixedCount) {
    const padded = [...parts];
    while (padded.length < fixedCount) padded.push('');
    padded.push('');
    return padded;
  }
  const head = parts.slice(0, fixedCount);
  head.push(parts.slice(fixedCount).join(UNIT_SEP));
  return head;
}

/** Parse a `%d` decoration string into ref entries (without parens/tag prefix). */
export function parseDecorations(decorations: string): string[] {
  const trimmed = decorations.trim();
  if (trimmed === '') return [];
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => (entry.startsWith('tag: ') ? entry.slice('tag: '.length) : entry));
}

export interface NumstatFile {
  readonly path: string;
  /** undefined for binary files (git reports `-`). */
  readonly additions?: number;
  readonly deletions?: number;
}

/** Parse `--numstat` output into structured file rows. */
export function parseNumstat(stdout: string): NumstatFile[] {
  const files: NumstatFile[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') continue;
    const tabIndex1 = trimmed.indexOf('\t');
    if (tabIndex1 < 0) continue;
    const tabIndex2 = trimmed.indexOf('\t', tabIndex1 + 1);
    if (tabIndex2 < 0) continue;
    const additions = trimmed.slice(0, tabIndex1);
    const deletions = trimmed.slice(tabIndex1 + 1, tabIndex2);
    const path = trimmed.slice(tabIndex2 + 1);
    files.push({
      path,
      additions: additions === '-' ? undefined : Number.parseInt(additions, 10),
      deletions: deletions === '-' ? undefined : Number.parseInt(deletions, 10),
    });
  }
  return files;
}

export interface BlameLine {
  readonly line: number;
  readonly oid: string;
  readonly author: string;
  /** ISO-8601 timestamp of the authoring commit. */
  readonly authoredAt: string;
  readonly summary: string;
  /** File content at that line — untrusted data from the repository. */
  readonly content: string;
}

/**
 * Parse `git blame --porcelain` output.
 *
 * The porcelain header of a commit is printed in full on its first line
 * block and abbreviated afterwards; a commit map fills the metadata from
 * whichever block carried it. Content lines always start with a tab.
 */
export function parsePorcelainBlame(stdout: string): BlameLine[] {
  const lines: BlameLine[] = [];
  const commitMeta = new Map<
    string,
    { author: string; authoredAt: string; summary: string }
  >();

  let current: { oid: string; finalLine: number } | undefined;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('\t')) {
      if (current === undefined) continue;
      const meta = commitMeta.get(current.oid);
      lines.push({
        line: current.finalLine,
        oid: current.oid,
        author: meta?.author ?? '',
        authoredAt: meta?.authoredAt ?? '',
        summary: meta?.summary ?? '',
        content: line.slice(1),
      });
      continue;
    }
    if (line === '') continue;

    const match = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (match) {
      const oid = match[1] as string;
      const finalLine = Number.parseInt(match[3] as string, 10);
      current = { oid, finalLine };
      if (!commitMeta.has(oid)) {
        commitMeta.set(oid, { author: '', authoredAt: '', summary: '' });
      }
      continue;
    }

    if (current === undefined) continue;
    const meta = commitMeta.get(current.oid);
    if (meta === undefined) continue;
    if (line.startsWith('author ')) {
      meta.author = line.slice('author '.length);
    } else if (line.startsWith('author-time ')) {
      const epoch = Number.parseInt(line.slice('author-time '.length), 10);
      if (Number.isFinite(epoch)) {
        meta.authoredAt = new Date(epoch * 1000).toISOString();
      }
    } else if (line.startsWith('summary ')) {
      meta.summary = line.slice('summary '.length);
    }
  }

  return lines;
}
