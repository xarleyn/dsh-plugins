/**
 * Retention contract for durable provenance.
 *
 * This module is deliberately free of Node imports: the resolved default
 * config reaches the browser bundle through `resolve-config`, and a single
 * `node:fs` import here would break that bundle at runtime.
 */

/**
 * What a sharded provenance store keeps. Every bound counts turns, shards or
 * days; zero means "keep everything" for that bound.
 */
export interface QaProvenanceRetention {
  /** Newest turns kept per chat. */
  readonly maxTurnsPerSession: number;
  /** Chats kept, most recently written first. */
  readonly maxSessions: number;
  /** Chats untouched for longer than this are dropped. */
  readonly maxAgeDays: number;
  /** How often a write may trigger the directory sweep. */
  readonly sweepIntervalMinutes: number;
}

/**
 * Defaults sized for a QA deployment: one chat is worth a few hundred turns, a
 * fortnight of chats is worth keeping, and an untouched month is finished.
 */
export const DEFAULT_QA_PROVENANCE_RETENTION: QaProvenanceRetention =
  Object.freeze({
    maxTurnsPerSession: 200,
    maxSessions: 500,
    maxAgeDays: 30,
    sweepIntervalMinutes: 60,
  });

/** Bounds the configuration validator enforces, mirrored for the CLI. */
export const QA_PROVENANCE_RETENTION_LIMITS = Object.freeze({
  maxTurnsPerSession: { min: 0, max: 10_000 },
  maxSessions: { min: 0, max: 100_000 },
  maxAgeDays: { min: 0, max: 3_650 },
  sweepIntervalMinutes: { min: 1, max: 1_440 },
});
