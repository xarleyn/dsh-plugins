/**
 * Attachment vocabulary shared by the Host configuration and the browser
 * composer. The module stays free of Node and DOM imports: the client bundle
 * imports it directly, and the Host resolver uses it to normalize the
 * operator's configuration.
 */

/**
 * Text-file extensions the composer accepts out of the box. Compared
 * lowercase and without the leading dot; an entry is a suffix, not a glob.
 */
export const DEFAULT_QA_TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  "md",
  "markdown",
  "txt",
  "text",
  "log",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "csv",
  "tsv",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "cmd",
  "sql",
  "patch",
  "diff",
]);

/** Bounds the resolver and the settings card agree on. */
export const QA_PASTED_TEXT_LINES_MIN = 0;
export const QA_PASTED_TEXT_LINES_MAX = 10_000;
export const QA_MAX_FILE_BYTES_MIN = 1024;
export const QA_MAX_FILE_BYTES_MAX = 52_428_800;
export const QA_MAX_PENDING_MIN = 1;
export const QA_MAX_PENDING_MAX = 40;

/** One accepted extension token: no dot, no separator, bounded length. */
const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,15}$/u;

/**
 * Normalize an operator-authored extension list: lowercase, leading dots
 * stripped, malformed entries and duplicates dropped, order preserved.
 * An empty result means no extension is accepted by name — the composer then
 * still accepts whatever the browser reports as `text/*`.
 * @param values - raw extension tokens from configuration.
 * @returns the normalized token list.
 */
export function normalizeTextExtensions(
  values: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const token = value.trim().toLowerCase().replace(/^\.+/u, "");
    if (!EXTENSION_PATTERN.test(token) || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }
  return normalized;
}

/**
 * Whether one file name carries an accepted text extension. The comparison is
 * case-insensitive; a name without a dot, or with a hidden-file dot only
 * (`.gitignore`), is matched against the whole leaf.
 * @param name - display file name.
 * @param extensions - normalized accepted extensions.
 * @returns whether the name matches one accepted extension.
 */
export function hasTextExtension(
  name: string,
  extensions: readonly string[],
): boolean {
  const leaf = name.trim().toLowerCase();
  if (leaf === "") return false;
  const dot = leaf.lastIndexOf(".");
  const suffix = dot <= 0 ? leaf : leaf.slice(dot + 1);
  return extensions.includes(suffix);
}

/**
 * Count the lines of a pasted blob the way a reader counts them: a single
 * trailing newline does not open a new line, and CRLF counts once.
 * @param text - pasted plain text.
 * @returns the line count, at least 1 for any non-empty text.
 */
export function countTextLines(text: string): number {
  const normalized = text.replace(/\r\n?/gu, "\n").replace(/\n$/u, "");
  return normalized === "" ? 0 : normalized.split("\n").length;
}
