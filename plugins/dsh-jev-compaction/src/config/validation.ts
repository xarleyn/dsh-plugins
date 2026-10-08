/**
 * The normalizing primitives `resolve.ts` is built from: integer ranges,
 * probabilities, and the whitelisted string fields. Each one refuses a value
 * outside its contract instead of coercing it, so a misconfiguration is heard
 * about at startup.
 */

import {
  ARCHIVE_FAILURE_POLICIES,
  type ArchiveFailurePolicy,
} from "./constants.js";

const LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
type LogLevel = (typeof LEVELS)[number];

export function clampInt(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`jev-compaction: ${label} must be a finite number`);
  }
  const clamped = Math.min(max, Math.max(min, Math.round(value)));
  return clamped;
}

export function clampProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`jev-compaction: ${label} must be within [0, 1]`);
  }
  return value;
}

export function resolveLevel(value: unknown, fallback: LogLevel): LogLevel {
  return typeof value === "string" &&
    (LEVELS as readonly string[]).includes(value)
    ? (value as LogLevel)
    : fallback;
}

/**
 * Normalize a tool-name list: drop non-strings and blanks, trim, deduplicate
 * case-sensitively (tool names are exact identifiers, not display text).
 */
export function resolveToolList(
  value: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    seen.add(trimmed);
  }
  return Object.freeze([...seen]);
}

export function resolveArchivePolicy(
  value: unknown,
  fallback: ArchiveFailurePolicy,
): ArchiveFailurePolicy {
  return typeof value === "string" &&
    (ARCHIVE_FAILURE_POLICIES as readonly string[]).includes(value)
    ? (value as ArchiveFailurePolicy)
    : fallback;
}
