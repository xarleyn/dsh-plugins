/**
 * The configuration types: the raw, user-facing shape (SPEC §22), the
 * validated, detached shape the planner and the Jev client work with, and the
 * live shape the Cordis loader hands to the service. The literal unions they
 * refer to live in `constants.ts`, the shipped values in `defaults.ts`, and the
 * runtime contract of the raw shape in `schema.ts`.
 */

import type { Volatile } from "@deepseek-ai/cordis";
import type { ArchiveFailurePolicy, SystemOneProvider } from "./constants.js";

/** Per-provider endpoint overrides (SPEC §22 `decision.<provider>`). */
export interface SystemOneProviderOverride {
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly model?: string;
}

/** Raw user-facing configuration (SPEC §22). */
export interface JevCompactionConfig {
  /** Master switch; when false the plugin listens but never acts. */
  readonly enabled?: boolean;
  /**
   * Decision backend selection (SPEC §18). The provider preset picks the
   * endpoint, key variable and model; `decision.<provider>` overrides
   * individual preset fields. `custom` requires an explicit `baseUrl`.
   */
  readonly decision?: {
    /** Which System One-compatible backend to call. */
    readonly provider?: SystemOneProvider;
    readonly typesafe?: SystemOneProviderOverride;
    readonly jeff?: SystemOneProviderOverride;
    readonly custom?: SystemOneProviderOverride;
    /** Per-request wall-clock budget in ms (clamped 500-60_000). */
    readonly timeoutMs?: number;
    /** Concurrent Jev request cap (clamped 1-8). */
    readonly maxConcurrency?: number;
    /** Network/5xx retries per batch, 0 or 1. */
    readonly retries?: number;
  };
  /**
   * Legacy flat transport block (pre-decision config shape). Its fields
   * override the resolved `decision` values one-for-one; new deployments
   * should configure `decision` instead.
   */
  readonly jev?: {
    /** Jev decision model name. */
    readonly model?: string;
    /**
     * Environment variable holding the API key. The key value itself is
     * never part of the config, the logs, or any report. An empty string
     * disables the Authorization header entirely (keyless local backends).
     */
    readonly apiKeyEnv?: string;
    /** Jev System One endpoint. */
    readonly baseUrl?: string;
    /** Per-request wall-clock budget in ms (clamped 500-60_000). */
    readonly timeoutMs?: number;
    /** Concurrent Jev request cap (clamped 1-8). */
    readonly maxConcurrency?: number;
    /** Network/5xx retries per batch, 0 or 1. */
    readonly retries?: number;
  };
  readonly trigger?: {
    /** Fraction of the context window that arms automatic pruning. */
    readonly contextRatio?: number;
    /** Minimum estimated surface tokens for automatic pruning. */
    readonly minSurfaceTokens?: number;
    /** Minimum eligible candidate count for automatic pruning. */
    readonly minCandidates?: number;
    /** Minimum total candidate text characters for automatic pruning. */
    readonly minCandidateChars?: number;
    /** Automatic runs are spaced at least this many turns apart. */
    readonly cooldownTurns?: number;
  };
  readonly preserve?: {
    /** Newest surface positions never touched (recent window). */
    readonly recentMessages?: number;
    /** Newest token budget never touched (measured from the tail). */
    readonly recentTokens?: number;
    /** Pin error results regardless of score. */
    readonly errors?: boolean;
  };
  readonly decisions?: {
    /** needContents at or above this keeps the result full. */
    readonly fullThreshold?: number;
    /** needContents at or above this keeps a truncated head/tail. */
    readonly truncateThreshold?: number;
  };
  readonly state?: {
    /** Estimated token ceiling for the Jev state. */
    readonly maxStateTokens?: number;
    /** Estimated token ceiling for state plus one question batch. */
    readonly maxRequestTokens?: number;
    /** Tool argument preview characters included in the state. */
    readonly toolInputChars?: number;
    /** Result preview characters included in the state. */
    readonly resultPreviewChars?: number;
  };
  readonly pruning?: {
    /** Head characters kept by KEEP_TRUNCATED. */
    readonly truncateHeadChars?: number;
    /** Tail characters kept by KEEP_TRUNCATED. */
    readonly truncateTailChars?: number;
    /** Do not mutate below this many estimated saved characters. */
    readonly minSavingsChars?: number;
    /** Do not mutate below this fraction of candidate characters. */
    readonly minSavingsRatio?: number;
  };
  /**
   * Immediate semantic shaping of large tool outputs at `tools/post-execute`
   * (result-shaping SPEC §10-§21): runs before the durable `tool/result` is
   * persisted, so it is opt-in and archives the original by default.
   */
  readonly resultShaping?: {
    /** Master switch; off by default — this path changes durable content. */
    readonly enabled?: boolean;
    /** Tools whose results may be shaped; exclusions win. */
    readonly includeTools?: readonly string[];
    /** Tools whose results are never shaped, whatever the allowlist says. */
    readonly excludeTools?: readonly string[];
    /** Minimum text length in characters before shaping is considered. */
    readonly thresholdChars?: number;
    /** Length that triggers consideration even without line structure. */
    readonly hardLengthTriggerChars?: number;
    /** Minimum line count for the line-structure trigger. */
    readonly minLines?: number;
    /** Minimum collapsed-line ratio for the repetition trigger. */
    readonly repetitionTriggerRatio?: number;
    /** Shaping requests allowed per turn. */
    readonly maxPerTurn?: number;
    /** Concurrent shaping requests (clamped 1-8). */
    readonly maxConcurrent?: number;
    /** Leave failed tool results untouched. */
    readonly preserveErrors?: boolean;
    /** Minimum run length that may collapse into one marker. */
    readonly minRunLines?: number;
    /** Head lines pinned from collapsing. */
    readonly keepHeadLines?: number;
    /** Tail lines pinned from collapsing. */
    readonly keepTailLines?: number;
    /** Minimum confidence to act on a classification. */
    readonly minClassificationConfidence?: number;
    /** Do not shape below this many saved characters. */
    readonly minSavingsChars?: number;
    /** Do not shape below this fraction of the original characters. */
    readonly minSavingsRatio?: number;
    /** Per-request wall-clock budget in ms (clamped 500-60_000). */
    readonly requestTimeoutMs?: number;
    /** Character budget for shaping requests per turn. */
    readonly maxInputCharsPerTurn?: number;
  };
  /**
   * Plugin-owned archive of the pre-shaping rendered result (result-shaping
   * SPEC §22-§25). Shaping happens before DSH persists the result, so without
   * an archive the original is not recoverable from session replay.
   */
  readonly archive?: {
    /** Persist originals before shaping. */
    readonly enabled?: boolean;
    /** Archive root; empty resolves under the harness home. */
    readonly rootPath?: string;
    /** Retention window in days; 0 keeps entries forever. */
    readonly retentionDays?: number;
    /** Retention ceiling in bytes; 0 disables the size cap. */
    readonly maxBytes?: number;
    /** Reuse the content-addressed entry instead of writing a duplicate. */
    readonly deduplicate?: boolean;
    /** What to do when the archive write fails. */
    readonly onFailure?: ArchiveFailurePolicy;
  };
  readonly privacy?: {
    /** Include user text (bounded) in the Jev state. */
    readonly includeUserText?: boolean;
    /** Include assistant text (bounded) in the Jev state. */
    readonly includeAssistantText?: boolean;
    /** Include tool argument previews in the Jev state. */
    readonly includeToolArguments?: boolean;
    /** Per-message user/assistant text budget in characters. */
    readonly textChars?: number;
  };
  readonly fallback?: {
    /** Always true in v1: failures never block the agent loop. */
    readonly continueOnFailure?: boolean;
  };
  readonly diagnostics?: {
    /** Structured log level for plugin events. */
    readonly logLevel?:
      "trace" | "debug" | "info" | "warn" | "error" | "silent";
    /** Include per-candidate scores in reports. */
    readonly includeCandidateScores?: boolean;
  };
}

/** Validated, detached, deeply immutable configuration. */
export interface ResolvedJevCompactionConfig {
  readonly enabled: boolean;
  /** The selected decision backend. */
  readonly decision: {
    readonly provider: SystemOneProvider;
  };
  readonly jev: {
    readonly model: string;
    readonly apiKeyEnv: string;
    readonly baseUrl: string;
    readonly timeoutMs: number;
    readonly maxConcurrency: number;
    readonly retries: number;
  };
  readonly trigger: {
    readonly contextRatio: number;
    readonly minSurfaceTokens: number;
    readonly minCandidates: number;
    readonly minCandidateChars: number;
    readonly cooldownTurns: number;
  };
  readonly preserve: {
    readonly recentMessages: number;
    readonly recentTokens: number;
    readonly errors: boolean;
  };
  readonly decisions: {
    readonly fullThreshold: number;
    readonly truncateThreshold: number;
  };
  readonly state: {
    readonly maxStateTokens: number;
    readonly maxRequestTokens: number;
    readonly toolInputChars: number;
    readonly resultPreviewChars: number;
  };
  readonly pruning: {
    readonly truncateHeadChars: number;
    readonly truncateTailChars: number;
    readonly minSavingsChars: number;
    readonly minSavingsRatio: number;
  };
  readonly resultShaping: {
    readonly enabled: boolean;
    readonly includeTools: readonly string[];
    readonly excludeTools: readonly string[];
    readonly thresholdChars: number;
    readonly hardLengthTriggerChars: number;
    readonly minLines: number;
    readonly repetitionTriggerRatio: number;
    readonly maxPerTurn: number;
    readonly maxConcurrent: number;
    readonly preserveErrors: boolean;
    readonly minRunLines: number;
    readonly keepHeadLines: number;
    readonly keepTailLines: number;
    readonly minClassificationConfidence: number;
    readonly minSavingsChars: number;
    readonly minSavingsRatio: number;
    readonly requestTimeoutMs: number;
    readonly maxInputCharsPerTurn: number;
  };
  readonly archive: {
    readonly enabled: boolean;
    /** Empty means "resolve under the harness home at runtime". */
    readonly rootPath: string;
    readonly retentionDays: number;
    readonly maxBytes: number;
    readonly deduplicate: boolean;
    readonly onFailure: ArchiveFailurePolicy;
  };
  readonly privacy: {
    readonly includeUserText: boolean;
    readonly includeAssistantText: boolean;
    readonly includeToolArguments: boolean;
    readonly textChars: number;
  };
  readonly fallback: {
    readonly continueOnFailure: boolean;
  };
  readonly diagnostics: {
    readonly logLevel: "trace" | "debug" | "info" | "warn" | "error" | "silent";
    readonly includeCandidateScores: boolean;
  };
}

/**
 * Config exactly as the Cordis loader hands it to the service: the fields the
 * settings card edits are `.volatile()`, so the loader passes a stable
 * reference there instead of a value, and a reference is only current until the
 * next `loader/volatile-update`. Read it through
 * {@link plainJevCompactionConfig}, never field by field.
 */
export type JevCompactionLiveConfig = LiveNodes<JevCompactionConfig>;

/**
 * A config shape where every node is either the plain value or the reference
 * the loader keeps in its place. The schema decides which node is which, so a
 * consumer that detaches the whole object (`live.ts`) does not have to track
 * that choice as the editable set grows.
 */
type LiveNodes<T> = {
  readonly [K in keyof T]-?:
    | Volatile<NonNullable<T[K]>>
    | (NonNullable<T[K]> extends readonly unknown[]
        ? NonNullable<T[K]>
        : NonNullable<T[K]> extends object
          ? LiveNodes<NonNullable<T[K]>>
          : NonNullable<T[K]>)
    | undefined;
};
