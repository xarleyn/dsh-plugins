/**
 * Immediate-shaping metrics (result-shaping SPEC §32).
 *
 * Counters are process-scoped and shared by every session: the settings card
 * and the logs report what this process did, not what one conversation did.
 * Historical-compaction counters stay in their own report — the two layers are
 * deliberately not summed into one number.
 */

/** Why a result was left alone; also the skip tags in the logs. */
export type ShapeSkipReason =
  | "disabled"
  | "tool-not-allowed"
  | "error-result"
  | "too-small"
  | "unsupported-content"
  | "already-spilled"
  | "already-shaped"
  | "nested-dispatch"
  | "turn-budget"
  | "not-repetitive"
  | "low-savings"
  | "low-confidence"
  | "jev-error"
  | "archive-error"
  | "empty-content"
  | "downstream-block"
  | "downstream-value-replacement"
  | "own-result";

/** Mutable counter set; one instance per plugin process. */
export class ShapingMetrics {
  private readonly counts = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  add(name: string, by: number): void {
    this.totals.set(name, (this.totals.get(name) ?? 0) + by);
  }

  count(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  total(name: string): number {
    return this.totals.get(name) ?? 0;
  }

  /** Flat, JSON-safe snapshot for logs and diagnostics. */
  snapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const [name, value] of this.counts) snapshot[name] = value;
    for (const [name, value] of this.totals) snapshot[name] = value;
    return snapshot;
  }

  reset(): void {
    this.counts.clear();
    this.totals.clear();
  }
}

/** Metric names, spelled once so the logs and the tests cannot drift. */
export const SHAPE_METRICS = {
  seen: "resultShaping.seen",
  eligible: "resultShaping.eligible",
  skipped: "resultShaping.skipped",
  requests: "resultShaping.requests",
  shaped: "resultShaping.shaped",
  keptOriginal: "resultShaping.keptOriginal",
  errors: "resultShaping.errors",
  timeouts: "resultShaping.timeouts",
  archiveWrites: "resultShaping.archiveWrites",
  archiveFailures: "resultShaping.archiveFailures",
  originalChars: "resultShaping.originalChars",
  persistedChars: "resultShaping.persistedChars",
  savedChars: "resultShaping.savedChars",
  jevInputEstimate: "resultShaping.jevInputEstimate",
  latencyMs: "resultShaping.latencyMs",
  jevLatencyMs: "resultShaping.jevLatencyMs",
  collapsedLines: "resultShaping.collapsedLines",
} as const;
