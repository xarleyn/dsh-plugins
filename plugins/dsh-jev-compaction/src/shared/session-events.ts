/**
 * The contract of the session events this plugin writes, shared by the Host
 * that appends them and the browser card that renders them (SPEC §28).
 *
 * Dependency-free on purpose: the client bundle inlines this module, so it
 * must not reach for a Host-only import.
 *
 * A compaction run is otherwise invisible outside the plugin log — the only
 * durable trace of it is the replaced `tool/result` bodies. These events carry
 * the run's METADATA into the append-only session log, so the conversation
 * shows one card per run and that card survives a reload, a fork and a
 * replayed session: the log is the single source of truth.
 *
 * Two rules are load-bearing:
 *
 * 1. **Metadata only.** No tool output, no prompt text, no state body, no
 *    archive path. The card argues from counts, seqs and scores; a reader who
 *    wants the originals reads the session log, never the card.
 * 2. **Never the core `compaction/*` vocabulary.** The core engine makes state
 *    decisions on replay of `compaction/start` / `compaction/end`, so a
 *    third-party event there would drive its state machine.
 */

/** One durable event appended after a run produced a plan. */
export const JEV_COMPACTION_APPLIED_EVENT = "jev-compaction/applied";

/** One durable event appended for a skipped run, when asked for. */
export const JEV_COMPACTION_SKIPPED_EVENT = "jev-compaction/skipped";

/** Every event type this plugin writes into a session log. */
export const JEV_COMPACTION_SESSION_EVENTS: readonly string[] = Object.freeze([
  JEV_COMPACTION_APPLIED_EVENT,
  JEV_COMPACTION_SKIPPED_EVENT,
]);

/** What the policy decided for one candidate. */
export type JevCompactionItemAction =
  "KEEP_FULL" | "KEEP_TRUNCATED" | "KEEP_STUB";

/** Why a run started. */
export type JevCompactionTrigger =
  "context-ratio" | "token-floor" | "command" | "queued";

/** How a run was invoked. */
export type JevCompactionRunMode = "auto" | "manual" | "dry-run";

/**
 * One candidate's outcome: the tool it belonged to, its size, the decision and
 * the two seqs that make the replacement auditable against the log. Scores are
 * the probabilities the backend returned, not a re-derivation of the policy.
 */
export interface JevCompactionItemRecord {
  readonly tool: string;
  readonly chars: number;
  readonly action: JevCompactionItemAction;
  /** `needContents` probability, absent when the backend answered nothing. */
  readonly needContents?: number;
  /** `needVerbatim` probability, when the backend answered that question. */
  readonly needVerbatim?: number;
  /** Surface seq of the original `tool/result`. */
  readonly originalSeq: number;
  /** Seq of the replacement event, or null when nothing was applied. */
  readonly replacementSeq: number | null;
}

/** Payload of `jev-compaction/applied`. */
export interface JevCompactionAppliedEventData {
  readonly mode: JevCompactionRunMode;
  readonly trigger: JevCompactionTrigger;
  /** Progressive state-fitting stage the scoring requests ran at. */
  readonly stage: string;
  readonly candidates: number;
  /** Candidates the policy chose to replace. */
  readonly mutations: number;
  /** Replacements that actually landed (0 for a dry-run). */
  readonly applied: number;
  /** Jev requests the run spent. */
  readonly batches: number;
  readonly maxConcurrency: number;
  readonly charsSaved: number;
  readonly tokensBefore: number | null;
  readonly tokensAfter: number | null;
  /** Resolved context window, when the route reported one. */
  readonly contextWindow: number | null;
  readonly actions: Readonly<Record<JevCompactionItemAction, number>>;
  readonly items: readonly JevCompactionItemRecord[];
}

/** Payload of `jev-compaction/skipped`. */
export interface JevCompactionSkippedEventData {
  readonly mode: JevCompactionRunMode;
  readonly reason: string;
  readonly candidates: number;
  readonly tokensBefore: number | null;
}

/** Terse reason a run produced no mutation. */
export type JevSkipReason =
  | "disabled"
  | "busy"
  | "pressure-not-met"
  | "cooldown"
  | "failure-backoff"
  | "not-enough-candidates"
  | "not-enough-candidate-chars"
  | "savings-gate"
  | "no-candidates"
  | "jev-failed"
  | "empty-plan";
