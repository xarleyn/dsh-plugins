/**
 * Text normalization for alignment only (§9).
 *
 * Two texts are compared twice, for two different questions:
 *
 * - *are these the same node?* — answered by {@link comparisonKeyOf}, which
 *   folds representation noise nothing downstream should care about;
 * - *what exactly changed?* — answered by a token diff over `rawText`, which
 *   normalization never touches.
 *
 * The line between the two is a rule, not a taste: normalize what a document
 * format did to the text (NBSP, soft hyphens, wrap artifacts, Unicode
 * composition) and never what an author did to the meaning. `не`, `10`, `%`,
 * `руб.` and `должен` all survive normalization, so a change that adds a
 * negation or edits a number can never be aligned away as "the same text".
 */

/** Whitespace that means "a space" but does not look like one. */
const EXOTIC_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;
/** Soft hyphens, zero-width spaces and stray BOMs: wrap artifacts, not text. */
const INVISIBLE_JOINERS = /[\u00ad\u200b\ufeff]/gu;

/** Fold representation noise, keeping every character that carries meaning. */
export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFC")
    .replace(INVISIBLE_JOINERS, "")
    .replace(EXOTIC_SPACES, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Collapse whitespace only. Used where a caller asked to ignore whitespace
 * differences but the text must otherwise stay as written.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Whether two texts differ only in whitespace. */
export function differsByWhitespaceOnly(left: string, right: string): boolean {
  return (
    left !== right && collapseWhitespace(left) === collapseWhitespace(right)
  );
}

/**
 * The alignment key of a piece of text. Callers that keep the original text do
 * so in `rawText`; this value is only ever compared, never shown.
 */
export function comparisonKeyOf(text: string): string {
  return normalizeForComparison(text);
}

/**
 * Case-insensitive identity for signal vocabulary lookups. `toLowerCase` and
 * not `toLocaleLowerCase`: the vocabulary is fixed, and a locale-sensitive
 * fold would make the signals depend on the host's default locale.
 */
export function foldForLookup(text: string): string {
  return normalizeForComparison(text).toLowerCase();
}
