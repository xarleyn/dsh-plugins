/**
 * Readers for fields of an upstream payload, shared by every provider
 * projection. An answer from the upstream is untrusted input: a field may be
 * missing, null, or of a shape the API changed without telling anyone. None of
 * these readers throws — each answers `undefined` or an empty value, and the
 * projection decides what a missing field means for that endpoint.
 *
 * The emptiness policy is one decision and lives here: a string field that
 * arrived empty counts as absent, like every other unusable value. A provider
 * that kept `""` as a value answered a caller with something no request can use
 * — an empty continuation cursor, for instance — so the caller had to guess
 * whether a token existed at all.
 */

/** An object field as a record; scalars, arrays and null become `{}`. */
export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A non-empty string field: the text, or `undefined` when there is none. */
export function stringOf(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A finite number field. Numeric strings stay strings, as the API sent them. */
export function numberOf(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** A boolean field, only when the upstream sent a boolean. */
export function booleanOf(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

/** An array field; anything that is not an array counts as no items. */
export function arrayOf(
  source: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/** Drop unset keys so a projection never answers with `undefined` holes. */
export function compact(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  );
}
