/**
 * Weblate search grammar (`q`), as the units endpoints parse it.
 *
 * The provider never passes a model-written query string through: it composes
 * clauses out of validated parts. The grammar itself comes from
 * `weblate/utils/search.py` of the upstream release this provider was written
 * against; only the operators and fields used below are listed, so an agent
 * cannot reach a lookup this provider has not thought about.
 */
import { IntegrationError } from "../../errors.js";

/**
 * Values of Weblate's `is:` lookup this provider exposes. `needs-editing` and
 * `fuzzy` are synonyms upstream, and `untranslated` is Weblate's own definition
 * (everything below "translated"), which therefore includes the strings marked
 * for editing.
 */
export const UNIT_STATE_FILTERS = [
  "untranslated",
  "needs-editing",
  "translated",
  "approved",
  "read-only",
] as const;

export type UnitStateFilter = (typeof UNIT_STATE_FILTERS)[number];

/** Text fields of a unit the agent may search inside. */
export const UNIT_TEXT_FIELDS = [
  "source",
  "target",
  "context",
  "note",
] as const;

export type UnitTextField = (typeof UNIT_TEXT_FIELDS)[number];

/** `has:` lookups this provider exposes; all are upstream-documented. */
export const FAILING_CHECK_CLAUSE = "has:check";
export const SUGGESTION_CLAUSE = "has:suggestion";
export const COMMENT_CLAUSE = "has:comment";

function invalid(): never {
  throw new IntegrationError("InvalidRequest", "Search text is invalid");
}

/**
 * One grammar value, always double-quoted with `\` and `"` escaped: the parser
 * accepts quoted strings for every field this provider uses, and a bare word
 * may not contain a space. Line breaks are refused rather than escaped, because
 * the grammar's whitespace escapes would silently turn them into something else.
 */
export function quoteQueryValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (value === "" || /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/** Exact match on a field whose value the agent named: a project, component or language. */
export function exactClause(
  field: "project" | "component" | "language",
  value: string,
): string {
  return `${field}:=${quoteQueryValue(value)}`;
}

/** Substring match inside one of the unit's own texts. */
export function textClause(field: UnitTextField, value: string): string {
  return `${field}:${quoteQueryValue(value)}`;
}

/** Weblate's `is:` state lookup, so the vocabulary stays upstream's own. */
export function stateClause(state: UnitStateFilter): string {
  if (!UNIT_STATE_FILTERS.includes(state)) invalid();
  return `is:${state}`;
}

export function isUnitStateFilter(value: unknown): value is UnitStateFilter {
  return (
    typeof value === "string" &&
    (UNIT_STATE_FILTERS as readonly string[]).includes(value)
  );
}

export function isUnitTextField(value: unknown): value is UnitTextField {
  return (
    typeof value === "string" &&
    (UNIT_TEXT_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Clauses joined the way Weblate reads them: `a AND b`, or nothing at all. A
 * filter that is asked for twice is asked for once — the same clause repeated
 * would narrow nothing and would only make the audit line harder to read.
 */
export function buildUnitQuery(clauses: readonly string[]): string {
  return [...new Set(clauses.filter((clause) => clause !== ""))].join(" AND ");
}
