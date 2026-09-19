/**
 * Pure presentation helpers of the OpenViking Memory card.
 *
 * Kept out of the components so the badge, override, and filter wording is
 * unit-testable without a DOM, and so every place that renders the same value
 * renders it identically. Type-only imports stay erased in the browser bundle.
 */

/**
 * Header badge wording. The master switch is on unless the user explicitly
 * turned it off, which mirrors `resolveInjectionPlan`'s reading of an absent
 * field.
 */
export function badgeText(autoInject: boolean | undefined): string {
  return autoInject === false ? "Manual recall" : "Auto-inject";
}

/**
 * Whether the user layer carries an explicit value for a top-level key. A
 * field's PRESENCE is what marks it overridden — an override whose value
 * equals the composition default is still an override, and comparing values
 * could not see it.
 */
export function isOverridden(user: unknown, key: string): boolean {
  if (typeof user !== "object" || user === null || Array.isArray(user)) {
    return false;
  }
  return Object.hasOwn(user as Record<string, unknown>, key);
}

/** Top-level keys the user layer carries; the reset-all action clears exactly these. */
export function overriddenKeys(user: unknown): string[] {
  if (typeof user !== "object" || user === null || Array.isArray(user)) {
    return [];
  }
  return Object.keys(user as Record<string, unknown>).sort();
}

/**
 * Parse a numeric control's draft text.
 * @returns the number, or null when the field is empty or not numeric (the
 * caller leaves the stored value alone rather than writing a NaN).
 */
export function parseNumberDraft(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Render the `captureFilters` array as one sed-style filter per line. */
export function filtersToText(filters: unknown): string {
  if (!Array.isArray(filters)) return "";
  return filters
    .map((entry) => (typeof entry === "string" ? entry : String(entry)))
    .join("\n");
}

/**
 * Parse the `captureFilters` textarea: one filter per line, blank lines and
 * surrounding whitespace dropped. An empty result means "no filters", which
 * the caller turns into a clear so the field re-inherits the composition
 * layer.
 */
export function textToFilters(text: string): string[] {
  return text
    .split(/\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
