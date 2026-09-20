/**
 * Line-shape normalization (result-shaping SPEC §16).
 *
 * Two lines share a shape when they differ only in volatile values. The shape
 * is used for *clustering only* — it never reaches the model — so the bar for
 * collapsing two lines is low, while the bar for erasing a value that could be
 * evidence is high.
 *
 * Replaced (values vary between runs, carry no decision-relevant meaning):
 *   ANSI escape sequences, ISO-8601 and clock timestamps, UUIDs, long hex
 *   hashes, percentages, and standalone counters of any width (`test 81`,
 *   `pkg-12`, `progress 1%`).
 *
 * Protected, and therefore part of the shape (each may be exactly what the
 * next decision needs): line and column positions, dotted versions and file
 * names, HTTP status codes, exit codes, and any identifier a digit is glued
 * to. Protected spans are lifted out before the counter rule runs and put back
 * afterwards, so the exclusions are explicit rather than an accident of a
 * lookaround.
 */

/**
 * CSI/OSC escape sequences emitted by colorized tools. Built from a raw
 * template so the escape characters stay spelled `\x1b` in the source instead
 * of appearing as literal control characters.
 */
const ANSI_PATTERN = new RegExp(
  String.raw`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`,
  "gu",
);

/** ISO-8601 date-times, with or without a zone. */
const ISO_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gu;

/** Bare clock times as log prefixes emit them: 12:01:04.512, 9:30. */
const CLOCK_PATTERN =
  /(?<![\d:])\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?![\d:])/gu;

/** Canonical UUIDs. */
const UUID_PATTERN =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/gu;

/** Long hex digests (short hashes stay: they are often referenced later). */
const LONG_HASH_PATTERN = /\b[0-9a-fA-F]{16,}\b/gu;

/** Percentages, including decimal ones: 12%, 99.5 %. */
const PERCENT_PATTERN = /\b\d+(?:[.,]\d+)?\s?%/gu;

/**
 * Standalone integer runs. The lookarounds keep a digit glued to a path
 * separator, a dot or a word character inside its token: `app.ts:123:45`,
 * `v20.11.1`, `report-2026.json` and `5b54e83` are all left intact.
 */
const COUNTER_PATTERN = /(?<![\w.:])\d+(?![\w.])/gu;

/**
 * Spans that must survive normalization, tried left to right:
 *
 * - a `file.ts:123:45` position (line and column are evidence a diagnostic is
 *   read against);
 * - a protocol verb, a path and an HTTP status code;
 * - an exit or status code spelled out after `code`, `status` or `exit`.
 *
 * Everything else relies on the counter rule's lookarounds, which keep digits
 * glued to a path separator, a dot or a letter inside their own token.
 */
const PROTECTED_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b[\w./\\-]+\.\w+:\d+(?::\d+)?/gu,
  /\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+\s+\d{3}\b/gu,
  /\b(?:exit|code|status)\s+\d+\b/giu,
]);

/**
 * Placeholder for one protected span. The key is spelled with a letter so the
 * counter rule cannot reach the digits inside it — a numeric key would be
 * normalized away before the restoration pass ever ran.
 */
function placeholder(index: number): string {
  return `\u0000P${index}\u0000`;
}

/** Lift protected spans out of the line, replacing each with a placeholder. */
function protect(line: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  let text = line;
  for (const pattern of PROTECTED_PATTERNS) {
    text = text.replace(pattern, (match) => {
      spans.push(match);
      return placeholder(spans.length - 1);
    });
  }
  return { text, spans };
}

/**
 * Placeholder pattern and the final safety net. Both are built from raw
 * templates so the NUL delimiter stays spelled `\u0000` in the source rather
 * than appearing as a literal control character.
 */
const PLACEHOLDER_PATTERN = new RegExp(String.raw`\u0000P(\d+)\u0000`, "gu");
const PLACEHOLDER_LEFTOVER = new RegExp(
  String.raw`\u0000[^\u0000]*\u0000`,
  "gu",
);

function restore(text: string, spans: readonly string[]): string {
  const restored = text.replace(
    PLACEHOLDER_PATTERN,
    (_match, index: string) => {
      return spans[Number(index)] ?? "";
    },
  );
  // A placeholder can only survive if restoration did not match; never let a
  // delimiter reach the shape, let alone the model.
  return restored.replace(PLACEHOLDER_LEFTOVER, "");
}

/**
 * Collapse whitespace runs so indentation does not split a shape.
 */
const WHITESPACE_PATTERN = /\s+/gu;

/**
 * Reduce one line to its shape key. The result is a cluster key, never output:
 * it is compared, counted and discarded.
 */
export function lineShape(line: string): string {
  const { text, spans } = protect(line.replace(ANSI_PATTERN, ""));
  const normalized = text
    .replace(ISO_TIMESTAMP_PATTERN, "<time>")
    .replace(UUID_PATTERN, "<uuid>")
    .replace(LONG_HASH_PATTERN, "<hash>")
    .replace(CLOCK_PATTERN, "<time>")
    .replace(PERCENT_PATTERN, "<percent>")
    .replace(COUNTER_PATTERN, "<number>");
  return restore(normalized, spans).replace(WHITESPACE_PATTERN, " ").trim();
}

/** True for a line that carries no content (blank or whitespace only). */
export function isBlank(line: string): boolean {
  return line.trim().length === 0;
}
