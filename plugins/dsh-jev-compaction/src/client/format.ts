/**
 * Read-only helpers for the card: the badge, override detection on the raw
 * user layer, and byte formatting for the archive limit.
 *
 * Overrides are detected by *presence* in the user layer (the settings
 * contract's own rule), never by comparing values: a user who re-saves the
 * deployment default still owns that field, and the card has to show it.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** True when the user layer carries an override at this path. */
export function isOverridden(user: unknown, ...path: string[]): boolean {
  let cursor: unknown = user;
  for (const segment of path) {
    const record = asRecord(cursor);
    if (record === undefined || !Object.hasOwn(record, segment)) return false;
    cursor = record[segment];
  }
  return true;
}

/** Top-level keys the user layer overrides. */
export function overriddenKeys(user: unknown): string[] {
  const record = asRecord(user);
  return record === undefined ? [] : Object.keys(record);
}

/** Header badge: on/off plus why it is off. */
export function badgeText(enabled: boolean, shapingEnabled: boolean): string {
  if (!enabled) return "disabled";
  return shapingEnabled ? "on · shaping" : "on";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human-readable byte size for the archive limit field. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** Split a byte amount into the largest whole-unit pair for the size field. */
export function splitBytes(bytes: number): { value: number; unit: string } {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return { value: Math.round(value * 100) / 100, unit: BYTE_UNITS[unit]! };
}

/** Multiply a unit back into bytes; unknown units fall back to bytes. */
export function toBytes(value: number, unit: string): number {
  const index = BYTE_UNITS.indexOf(unit as (typeof BYTE_UNITS)[number]);
  if (index < 0) return value;
  return Math.round(value * 1024 ** index);
}

/**
 * Say how many candidate runs the current thresholds plausibly admit. This is
 * a read-only projection of the trigger numbers, not a measurement: the card
 * must never imply it measured a generation it did not run.
 */
export function triggerSummary(
  thresholdChars: number,
  minLines: number,
): string {
  return `${thresholdChars} chars, ${minLines}+ lines, or repeated lines`;
}
