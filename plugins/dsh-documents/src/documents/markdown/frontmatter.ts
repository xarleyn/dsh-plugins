/**
 * Front-matter handling (§35).
 *
 * A generated document may carry a leading `---` block with scalar metadata.
 * Only scalars are read: the block feeds document properties and the manifest,
 * never a nested configuration surface, so there is nothing here an author
 * could use to reach a backend option.
 */

export interface FrontMatter {
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
}

const FRONT_MATTER_PATTERN =
  /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split leading front matter from the body. Malformed lines are ignored. */
export function parseFrontMatter(markdown: string): FrontMatter {
  const match = FRONT_MATTER_PATTERN.exec(markdown);
  if (match === null) return { attributes: {}, body: markdown };
  const attributes: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key === "" || key.startsWith("-")) continue;
    attributes[key] = unquote(line.slice(separator + 1));
  }
  return { attributes, body: markdown.slice(match[0].length) };
}
