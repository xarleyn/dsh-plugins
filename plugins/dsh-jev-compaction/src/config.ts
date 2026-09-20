/**
 * Configuration surface of the dsh-jev-compaction plugin.
 *
 * The Schemastery schema (`JevCompactionConfigSchema`) is the user-facing
 * contract exposed through the Cordis `Config` convention on the service;
 * `resolveJevCompactionConfig` normalizes raw config into fully defaulted,
 * clamped values, so the planner and the Jev client never see optional
 * fields or unsafe limits. Field semantics follow the plugin SPEC §22.
 */

import z from "@deepseek-ai/schemastery";

/** Endpoint presets shipped with the plugin (SPEC §18, §26.3). */
export const SYSTEM_ONE_PRESETS = {
  typesafe: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    apiKeyEnv: "TYPESAFE_API_KEY",
    model: "jev-latest",
  },
  jeff: {
    baseUrl: "http://localhost:8000",
    apiKeyEnv: "JEFF_API_KEY",
    model: "jev-latest",
  },
  custom: {
    baseUrl: "",
    apiKeyEnv: "",
    model: "jev-latest",
  },
} as const;

export type SystemOneProvider = keyof typeof SYSTEM_ONE_PRESETS;
export const SYSTEM_ONE_PROVIDERS: readonly SystemOneProvider[] = [
  "typesafe",
  "jeff",
  "custom",
];

/** Per-provider endpoint overrides (SPEC §22 `decision.<provider>`). */
export interface SystemOneProviderOverride {
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly model?: string;
}

/**
 * Tools shaped by default (SPEC §11.1 of the result-shaping SPEC). Only
 * command-like tools whose output is bulk, line-oriented and cheaply
 * reproducible: everything else — file reads, diffs, searches, structured
 * business tools, subagent results — may carry unique evidence that cannot be
 * recovered from output shape alone.
 */
export const DEFAULT_SHAPE_TOOLS: readonly string[] = Object.freeze([
  "bash",
  "terminal",
  "pwsh",
  "run_command",
  "execute_command",
  "run_tests",
]);

/** Result-shaping category of one collapsed run (SPEC §18). */
export const SHAPING_KINDS = [
  "routine_progress",
  "summary",
  "warning",
  "failure",
  "important_evidence",
  "unknown",
] as const;

export type ShapingKind = (typeof SHAPING_KINDS)[number];

/** Archive failure policy (SPEC §24). */
export const ARCHIVE_FAILURE_POLICIES = [
  "keep-original",
  "shape-anyway",
] as const;

export type ArchiveFailurePolicy = (typeof ARCHIVE_FAILURE_POLICIES)[number];

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

/** Defaults mirror the SPEC §22 suggested values. */
export const DEFAULTS: ResolvedJevCompactionConfig = Object.freeze({
  enabled: true,
  decision: Object.freeze({ provider: "typesafe" as const }),
  jev: Object.freeze({
    model: SYSTEM_ONE_PRESETS.typesafe.model,
    apiKeyEnv: SYSTEM_ONE_PRESETS.typesafe.apiKeyEnv,
    baseUrl: SYSTEM_ONE_PRESETS.typesafe.baseUrl,
    timeoutMs: 2500,
    maxConcurrency: 4,
    retries: 0,
  }),
  trigger: Object.freeze({
    contextRatio: 0.7,
    minSurfaceTokens: 32000,
    minCandidates: 4,
    minCandidateChars: 8000,
    cooldownTurns: 3,
  }),
  preserve: Object.freeze({
    recentMessages: 6,
    recentTokens: 12000,
    errors: true,
  }),
  decisions: Object.freeze({
    fullThreshold: 0.7,
    truncateThreshold: 0.45,
  }),
  state: Object.freeze({
    maxStateTokens: 25000,
    maxRequestTokens: 30000,
    toolInputChars: 1000,
    resultPreviewChars: 300,
  }),
  pruning: Object.freeze({
    truncateHeadChars: 384,
    truncateTailChars: 128,
    minSavingsChars: 8000,
    minSavingsRatio: 0.05,
  }),
  resultShaping: Object.freeze({
    enabled: false,
    includeTools: DEFAULT_SHAPE_TOOLS,
    excludeTools: Object.freeze([]) as readonly string[],
    thresholdChars: 12000,
    hardLengthTriggerChars: 32000,
    minLines: 80,
    repetitionTriggerRatio: 0.45,
    maxPerTurn: 2,
    maxConcurrent: 2,
    preserveErrors: true,
    minRunLines: 3,
    keepHeadLines: 8,
    keepTailLines: 12,
    minClassificationConfidence: 0.6,
    minSavingsChars: 4000,
    minSavingsRatio: 0.3,
    requestTimeoutMs: 2500,
    maxInputCharsPerTurn: 50000,
  }),
  archive: Object.freeze({
    enabled: true,
    rootPath: "",
    retentionDays: 14,
    maxBytes: 1_073_741_824,
    deduplicate: true,
    onFailure: "keep-original" as const,
  }),
  privacy: Object.freeze({
    includeUserText: true,
    includeAssistantText: true,
    includeToolArguments: true,
    textChars: 1000,
  }),
  fallback: Object.freeze({ continueOnFailure: true }),
  diagnostics: Object.freeze({
    logLevel: "info" as const,
    includeCandidateScores: false,
  }),
});

const LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
type LogLevel = (typeof LEVELS)[number];

function clampInt(
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

function clampProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`jev-compaction: ${label} must be within [0, 1]`);
  }
  return value;
}

function resolveLevel(value: unknown, fallback: LogLevel): LogLevel {
  return typeof value === "string" &&
    (LEVELS as readonly string[]).includes(value)
    ? (value as LogLevel)
    : fallback;
}

/**
 * Normalize a tool-name list: drop non-strings and blanks, trim, deduplicate
 * case-sensitively (tool names are exact identifiers, not display text).
 */
function resolveToolList(
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

function resolveArchivePolicy(
  value: unknown,
  fallback: ArchiveFailurePolicy,
): ArchiveFailurePolicy {
  return typeof value === "string" &&
    (ARCHIVE_FAILURE_POLICIES as readonly string[]).includes(value)
    ? (value as ArchiveFailurePolicy)
    : fallback;
}

/**
 * Resolve the decision backend endpoint: pick the provider preset, layer the
 * `decision.<provider>` overrides on top, then let the legacy flat `jev`
 * block override one-for-one. `provider: custom` must carry an explicit
 * `baseUrl` — a misconfigured endpoint must fail loudly at startup.
 */
function resolveEndpoint(raw: JevCompactionConfig): {
  decision: ResolvedJevCompactionConfig["decision"];
  endpoint: Pick<
    ResolvedJevCompactionConfig["jev"],
    "model" | "apiKeyEnv" | "baseUrl"
  >;
} {
  const rawDecision = raw.decision ?? {};
  const provider = rawDecision.provider ?? DEFAULTS.decision.provider;
  if (!(SYSTEM_ONE_PROVIDERS as readonly string[]).includes(provider)) {
    throw new TypeError(
      `jev-compaction: decision.provider must be one of ${SYSTEM_ONE_PROVIDERS.join(", ")}`,
    );
  }
  const preset = SYSTEM_ONE_PRESETS[provider];
  const override: SystemOneProviderOverride | undefined = rawDecision[provider];
  const endpoint = {
    model: override?.model ?? preset.model,
    apiKeyEnv: override?.apiKeyEnv ?? preset.apiKeyEnv,
    baseUrl: override?.baseUrl ?? preset.baseUrl,
  };
  endpoint.model = raw.jev?.model ?? endpoint.model;
  endpoint.apiKeyEnv = raw.jev?.apiKeyEnv ?? endpoint.apiKeyEnv;
  endpoint.baseUrl = raw.jev?.baseUrl ?? endpoint.baseUrl;
  if (provider === "custom" && endpoint.baseUrl.length === 0) {
    throw new TypeError(
      "jev-compaction: decision.custom.baseUrl is required when provider is custom",
    );
  }
  return { decision: { provider }, endpoint };
}

/**
 * Normalize raw config: apply defaults, clamp ranges, and enforce the
 * threshold ordering. Throws on non-finite scalars and inverted thresholds —
 * a misconfigured safety threshold must fail loudly at startup, not silently
 * prune or silently do nothing.
 */
export function resolveJevCompactionConfig(
  raw: JevCompactionConfig = {},
): ResolvedJevCompactionConfig {
  const decisions = {
    fullThreshold: clampProbability(
      raw.decisions?.fullThreshold ?? DEFAULTS.decisions.fullThreshold,
      "decisions.fullThreshold",
    ),
    truncateThreshold: clampProbability(
      raw.decisions?.truncateThreshold ?? DEFAULTS.decisions.truncateThreshold,
      "decisions.truncateThreshold",
    ),
  };
  if (decisions.truncateThreshold > decisions.fullThreshold) {
    throw new TypeError(
      "jev-compaction: decisions.truncateThreshold must be <= decisions.fullThreshold",
    );
  }
  const { decision, endpoint } = resolveEndpoint(raw);
  return {
    enabled: raw.enabled ?? DEFAULTS.enabled,
    decision,
    jev: {
      model: endpoint.model,
      apiKeyEnv: endpoint.apiKeyEnv,
      baseUrl: endpoint.baseUrl,
      timeoutMs: clampInt(
        raw.decision?.timeoutMs ?? raw.jev?.timeoutMs ?? DEFAULTS.jev.timeoutMs,
        500,
        60_000,
        "decision.timeoutMs",
      ),
      maxConcurrency: clampInt(
        raw.decision?.maxConcurrency ??
          raw.jev?.maxConcurrency ??
          DEFAULTS.jev.maxConcurrency,
        1,
        8,
        "decision.maxConcurrency",
      ),
      retries: clampInt(
        raw.decision?.retries ?? raw.jev?.retries ?? DEFAULTS.jev.retries,
        0,
        1,
        "decision.retries",
      ),
    },
    trigger: {
      contextRatio: clampProbability(
        raw.trigger?.contextRatio ?? DEFAULTS.trigger.contextRatio,
        "trigger.contextRatio",
      ),
      minSurfaceTokens: clampInt(
        raw.trigger?.minSurfaceTokens ?? DEFAULTS.trigger.minSurfaceTokens,
        1,
        Number.MAX_SAFE_INTEGER,
        "trigger.minSurfaceTokens",
      ),
      minCandidates: clampInt(
        raw.trigger?.minCandidates ?? DEFAULTS.trigger.minCandidates,
        1,
        10_000,
        "trigger.minCandidates",
      ),
      minCandidateChars: clampInt(
        raw.trigger?.minCandidateChars ?? DEFAULTS.trigger.minCandidateChars,
        0,
        Number.MAX_SAFE_INTEGER,
        "trigger.minCandidateChars",
      ),
      cooldownTurns: clampInt(
        raw.trigger?.cooldownTurns ?? DEFAULTS.trigger.cooldownTurns,
        0,
        10_000,
        "trigger.cooldownTurns",
      ),
    },
    preserve: {
      recentMessages: clampInt(
        raw.preserve?.recentMessages ?? DEFAULTS.preserve.recentMessages,
        0,
        100_000,
        "preserve.recentMessages",
      ),
      recentTokens: clampInt(
        raw.preserve?.recentTokens ?? DEFAULTS.preserve.recentTokens,
        0,
        Number.MAX_SAFE_INTEGER,
        "preserve.recentTokens",
      ),
      errors: raw.preserve?.errors ?? DEFAULTS.preserve.errors,
    },
    decisions,
    state: {
      maxStateTokens: clampInt(
        raw.state?.maxStateTokens ?? DEFAULTS.state.maxStateTokens,
        1000,
        1_000_000,
        "state.maxStateTokens",
      ),
      maxRequestTokens: clampInt(
        raw.state?.maxRequestTokens ?? DEFAULTS.state.maxRequestTokens,
        1000,
        1_000_000,
        "state.maxRequestTokens",
      ),
      toolInputChars: clampInt(
        raw.state?.toolInputChars ?? DEFAULTS.state.toolInputChars,
        0,
        100_000,
        "state.toolInputChars",
      ),
      resultPreviewChars: clampInt(
        raw.state?.resultPreviewChars ?? DEFAULTS.state.resultPreviewChars,
        0,
        100_000,
        "state.resultPreviewChars",
      ),
    },
    pruning: {
      truncateHeadChars: clampInt(
        raw.pruning?.truncateHeadChars ?? DEFAULTS.pruning.truncateHeadChars,
        0,
        1_000_000,
        "pruning.truncateHeadChars",
      ),
      truncateTailChars: clampInt(
        raw.pruning?.truncateTailChars ?? DEFAULTS.pruning.truncateTailChars,
        0,
        1_000_000,
        "pruning.truncateTailChars",
      ),
      minSavingsChars: clampInt(
        raw.pruning?.minSavingsChars ?? DEFAULTS.pruning.minSavingsChars,
        0,
        Number.MAX_SAFE_INTEGER,
        "pruning.minSavingsChars",
      ),
      minSavingsRatio: clampProbability(
        raw.pruning?.minSavingsRatio ?? DEFAULTS.pruning.minSavingsRatio,
        "pruning.minSavingsRatio",
      ),
    },
    resultShaping: {
      enabled: raw.resultShaping?.enabled ?? DEFAULTS.resultShaping.enabled,
      includeTools: resolveToolList(
        raw.resultShaping?.includeTools,
        DEFAULTS.resultShaping.includeTools,
      ),
      excludeTools: resolveToolList(
        raw.resultShaping?.excludeTools,
        DEFAULTS.resultShaping.excludeTools,
      ),
      thresholdChars: clampInt(
        raw.resultShaping?.thresholdChars ??
          DEFAULTS.resultShaping.thresholdChars,
        0,
        Number.MAX_SAFE_INTEGER,
        "resultShaping.thresholdChars",
      ),
      hardLengthTriggerChars: clampInt(
        raw.resultShaping?.hardLengthTriggerChars ??
          DEFAULTS.resultShaping.hardLengthTriggerChars,
        0,
        Number.MAX_SAFE_INTEGER,
        "resultShaping.hardLengthTriggerChars",
      ),
      minLines: clampInt(
        raw.resultShaping?.minLines ?? DEFAULTS.resultShaping.minLines,
        1,
        1_000_000,
        "resultShaping.minLines",
      ),
      repetitionTriggerRatio: clampProbability(
        raw.resultShaping?.repetitionTriggerRatio ??
          DEFAULTS.resultShaping.repetitionTriggerRatio,
        "resultShaping.repetitionTriggerRatio",
      ),
      maxPerTurn: clampInt(
        raw.resultShaping?.maxPerTurn ?? DEFAULTS.resultShaping.maxPerTurn,
        0,
        1000,
        "resultShaping.maxPerTurn",
      ),
      maxConcurrent: clampInt(
        raw.resultShaping?.maxConcurrent ??
          DEFAULTS.resultShaping.maxConcurrent,
        1,
        8,
        "resultShaping.maxConcurrent",
      ),
      preserveErrors:
        raw.resultShaping?.preserveErrors ??
        DEFAULTS.resultShaping.preserveErrors,
      minRunLines: clampInt(
        raw.resultShaping?.minRunLines ?? DEFAULTS.resultShaping.minRunLines,
        2,
        1000,
        "resultShaping.minRunLines",
      ),
      keepHeadLines: clampInt(
        raw.resultShaping?.keepHeadLines ??
          DEFAULTS.resultShaping.keepHeadLines,
        0,
        100_000,
        "resultShaping.keepHeadLines",
      ),
      keepTailLines: clampInt(
        raw.resultShaping?.keepTailLines ??
          DEFAULTS.resultShaping.keepTailLines,
        0,
        100_000,
        "resultShaping.keepTailLines",
      ),
      minClassificationConfidence: clampProbability(
        raw.resultShaping?.minClassificationConfidence ??
          DEFAULTS.resultShaping.minClassificationConfidence,
        "resultShaping.minClassificationConfidence",
      ),
      minSavingsChars: clampInt(
        raw.resultShaping?.minSavingsChars ??
          DEFAULTS.resultShaping.minSavingsChars,
        0,
        Number.MAX_SAFE_INTEGER,
        "resultShaping.minSavingsChars",
      ),
      minSavingsRatio: clampProbability(
        raw.resultShaping?.minSavingsRatio ??
          DEFAULTS.resultShaping.minSavingsRatio,
        "resultShaping.minSavingsRatio",
      ),
      requestTimeoutMs: clampInt(
        raw.resultShaping?.requestTimeoutMs ??
          DEFAULTS.resultShaping.requestTimeoutMs,
        500,
        60_000,
        "resultShaping.requestTimeoutMs",
      ),
      maxInputCharsPerTurn: clampInt(
        raw.resultShaping?.maxInputCharsPerTurn ??
          DEFAULTS.resultShaping.maxInputCharsPerTurn,
        0,
        Number.MAX_SAFE_INTEGER,
        "resultShaping.maxInputCharsPerTurn",
      ),
    },
    archive: {
      enabled: raw.archive?.enabled ?? DEFAULTS.archive.enabled,
      rootPath: raw.archive?.rootPath ?? DEFAULTS.archive.rootPath,
      retentionDays: clampInt(
        raw.archive?.retentionDays ?? DEFAULTS.archive.retentionDays,
        0,
        36_500,
        "archive.retentionDays",
      ),
      maxBytes: clampInt(
        raw.archive?.maxBytes ?? DEFAULTS.archive.maxBytes,
        0,
        Number.MAX_SAFE_INTEGER,
        "archive.maxBytes",
      ),
      deduplicate: raw.archive?.deduplicate ?? DEFAULTS.archive.deduplicate,
      onFailure: resolveArchivePolicy(
        raw.archive?.onFailure,
        DEFAULTS.archive.onFailure,
      ),
    },
    privacy: {
      includeUserText:
        raw.privacy?.includeUserText ?? DEFAULTS.privacy.includeUserText,
      includeAssistantText:
        raw.privacy?.includeAssistantText ??
        DEFAULTS.privacy.includeAssistantText,
      includeToolArguments:
        raw.privacy?.includeToolArguments ??
        DEFAULTS.privacy.includeToolArguments,
      textChars: clampInt(
        raw.privacy?.textChars ?? DEFAULTS.privacy.textChars,
        0,
        100_000,
        "privacy.textChars",
      ),
    },
    fallback: {
      continueOnFailure:
        raw.fallback?.continueOnFailure ?? DEFAULTS.fallback.continueOnFailure,
    },
    diagnostics: {
      logLevel: resolveLevel(
        raw.diagnostics?.logLevel,
        DEFAULTS.diagnostics.logLevel,
      ),
      includeCandidateScores:
        raw.diagnostics?.includeCandidateScores ??
        DEFAULTS.diagnostics.includeCandidateScores,
    },
  };
}

/** Schemastery schema exposed through the service's static `Config`. */
export const JevCompactionConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(DEFAULTS.enabled)
    .description("Enable Jev compaction."),
  decision: z.object({
    provider: z
      .string()
      .default(DEFAULTS.decision.provider)
      .description(
        "System One-compatible decision backend: typesafe (hosted Jev), jeff (self-hosted), or custom.",
      ),
    typesafe: z
      .object({
        baseUrl: z.string().description("TypeSafe System One endpoint."),
        apiKeyEnv: z
          .string()
          .description("Environment variable holding the TypeSafe API key."),
        model: z.string().description("Jev decision model."),
      })
      .description("Overrides for the typesafe provider preset."),
    jeff: z
      .object({
        baseUrl: z.string().description("Self-hosted Jeff endpoint."),
        apiKeyEnv: z
          .string()
          .description("Environment variable holding the Jeff API key."),
        model: z.string().description("Jev decision model."),
      })
      .description("Overrides for the self-hosted jeff provider preset."),
    custom: z
      .object({
        baseUrl: z
          .string()
          .description("Required System One-compatible endpoint."),
        apiKeyEnv: z
          .string()
          .description(
            "Environment variable holding the API key; empty disables the Authorization header.",
          ),
        model: z.string().description("Jev decision model."),
      })
      .description("Overrides for the custom provider preset."),
    timeoutMs: z
      .number()
      .min(500)
      .max(60_000)
      .step(1)
      .description("Per-request timeout in ms."),
    maxConcurrency: z
      .number()
      .min(1)
      .max(8)
      .step(1)
      .description("Concurrent Jev request cap."),
    retries: z
      .number()
      .min(0)
      .max(1)
      .step(1)
      .description("Network/5xx retries per batch (0 or 1)."),
  }),
  jev: z.object({
    model: z
      .string()
      .default(DEFAULTS.jev.model)
      .description("Jev decision model (legacy override; prefer decision)."),
    apiKeyEnv: z
      .string()
      .default(DEFAULTS.jev.apiKeyEnv)
      .description(
        "Environment variable that holds the API key (legacy override; prefer decision).",
      ),
    baseUrl: z
      .string()
      .default(DEFAULTS.jev.baseUrl)
      .description("Jev endpoint (legacy override; prefer decision)."),
    timeoutMs: z
      .number()
      .min(500)
      .max(60_000)
      .step(1)
      .default(DEFAULTS.jev.timeoutMs)
      .description("Per-request timeout in ms."),
    maxConcurrency: z
      .number()
      .min(1)
      .max(8)
      .step(1)
      .default(DEFAULTS.jev.maxConcurrency)
      .description("Concurrent Jev request cap."),
    retries: z
      .number()
      .min(0)
      .max(1)
      .step(1)
      .default(DEFAULTS.jev.retries)
      .description("Network/5xx retries per batch (0 or 1)."),
  }),
  trigger: z.object({
    contextRatio: z
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.trigger.contextRatio)
      .description("Context-window fraction that arms automatic pruning."),
    minSurfaceTokens: z
      .number()
      .min(1)
      .step(1)
      .default(DEFAULTS.trigger.minSurfaceTokens)
      .description("Minimum estimated surface tokens for automatic pruning."),
    minCandidates: z
      .number()
      .min(1)
      .step(1)
      .default(DEFAULTS.trigger.minCandidates)
      .description("Minimum eligible candidates for automatic pruning."),
    minCandidateChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.trigger.minCandidateChars)
      .description("Minimum total candidate characters for automatic pruning."),
    cooldownTurns: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.trigger.cooldownTurns)
      .description("Minimum turns between automatic runs."),
  }),
  preserve: z.object({
    recentMessages: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.preserve.recentMessages)
      .description("Newest surface positions never touched."),
    recentTokens: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.preserve.recentTokens)
      .description("Newest token budget never touched."),
    errors: z
      .boolean()
      .default(DEFAULTS.preserve.errors)
      .description("Pin error results regardless of score."),
  }),
  decisions: z.object({
    fullThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.decisions.fullThreshold)
      .description("needContents at or above this keeps the result full."),
    truncateThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.decisions.truncateThreshold)
      .description(
        "needContents at or above this keeps a truncated head/tail.",
      ),
  }),
  state: z.object({
    maxStateTokens: z
      .number()
      .min(1000)
      .step(1)
      .default(DEFAULTS.state.maxStateTokens)
      .description("Estimated token ceiling for the Jev state."),
    maxRequestTokens: z
      .number()
      .min(1000)
      .step(1)
      .default(DEFAULTS.state.maxRequestTokens)
      .description(
        "Estimated token ceiling for state plus one question batch.",
      ),
    toolInputChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.state.toolInputChars)
      .description("Tool argument preview characters in the state."),
    resultPreviewChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.state.resultPreviewChars)
      .description("Result preview characters in the state."),
  }),
  pruning: z.object({
    truncateHeadChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.pruning.truncateHeadChars)
      .description("Head characters kept by truncation."),
    truncateTailChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.pruning.truncateTailChars)
      .description("Tail characters kept by truncation."),
    minSavingsChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.pruning.minSavingsChars)
      .description("Skip mutation below this many saved characters."),
    minSavingsRatio: z
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.pruning.minSavingsRatio)
      .description(
        "Skip mutation below this fraction of candidate characters.",
      ),
  }),
  resultShaping: z
    .object({
      enabled: z
        .boolean()
        .default(DEFAULTS.resultShaping.enabled)
        .description(
          "Immediate semantic shaping of large tool outputs before they are persisted.",
        ),
      includeTools: z
        .array(z.string())
        .default([...DEFAULTS.resultShaping.includeTools])
        .description("Tools whose results may be shaped."),
      excludeTools: z
        .array(z.string())
        .default([...DEFAULTS.resultShaping.excludeTools])
        .description(
          "Tools whose results are never shaped; wins over the allowlist.",
        ),
      thresholdChars: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.thresholdChars)
        .description("Minimum text length before shaping is considered."),
      hardLengthTriggerChars: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.hardLengthTriggerChars)
        .description("Length that triggers shaping without line structure."),
      minLines: z
        .number()
        .min(1)
        .step(1)
        .default(DEFAULTS.resultShaping.minLines)
        .description("Minimum line count for the line-structure trigger."),
      repetitionTriggerRatio: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULTS.resultShaping.repetitionTriggerRatio)
        .description(
          "Minimum collapsible-line ratio for the repetition trigger.",
        ),
      maxPerTurn: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.maxPerTurn)
        .description("Shaping requests allowed per turn."),
      maxConcurrent: z
        .number()
        .min(1)
        .max(8)
        .step(1)
        .default(DEFAULTS.resultShaping.maxConcurrent)
        .description("Concurrent shaping requests."),
      preserveErrors: z
        .boolean()
        .default(DEFAULTS.resultShaping.preserveErrors)
        .description("Leave failed tool results untouched."),
      minRunLines: z
        .number()
        .min(2)
        .step(1)
        .default(DEFAULTS.resultShaping.minRunLines)
        .description("Minimum run length that may collapse into one marker."),
      keepHeadLines: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.keepHeadLines)
        .description("Head lines pinned from collapsing."),
      keepTailLines: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.keepTailLines)
        .description("Tail lines pinned from collapsing."),
      minClassificationConfidence: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULTS.resultShaping.minClassificationConfidence)
        .description("Minimum confidence to act on a classification."),
      minSavingsChars: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.minSavingsChars)
        .description("Skip shaping below this many saved characters."),
      minSavingsRatio: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULTS.resultShaping.minSavingsRatio)
        .description(
          "Skip shaping below this fraction of the original characters.",
        ),
      requestTimeoutMs: z
        .number()
        .min(500)
        .max(60_000)
        .step(1)
        .default(DEFAULTS.resultShaping.requestTimeoutMs)
        .description("Per-request timeout for shaping in ms."),
      maxInputCharsPerTurn: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.maxInputCharsPerTurn)
        .description("Character budget for shaping requests per turn."),
    })
    .description("Immediate result shaping at tools/post-execute."),
  archive: z
    .object({
      enabled: z
        .boolean()
        .default(DEFAULTS.archive.enabled)
        .description("Archive the original rendered result before shaping it."),
      rootPath: z
        .string()
        .default(DEFAULTS.archive.rootPath)
        .description(
          "Archive root; empty resolves under the harness home data directory.",
        ),
      retentionDays: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.archive.retentionDays)
        .description("Retention window in days; 0 keeps entries forever."),
      maxBytes: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.archive.maxBytes)
        .description("Retention ceiling in bytes; 0 disables the size cap."),
      deduplicate: z
        .boolean()
        .default(DEFAULTS.archive.deduplicate)
        .description("Reuse content-addressed entries instead of duplicating."),
      onFailure: z
        .union([...ARCHIVE_FAILURE_POLICIES])
        .default(DEFAULTS.archive.onFailure)
        .description(
          "Archive failure policy: keep-original (recommended) or shape-anyway.",
        ),
    })
    .description("Plugin-owned archive of pre-shaping tool output."),
  privacy: z.object({
    includeUserText: z
      .boolean()
      .default(DEFAULTS.privacy.includeUserText)
      .description("Include bounded user text in the Jev state."),
    includeAssistantText: z
      .boolean()
      .default(DEFAULTS.privacy.includeAssistantText)
      .description("Include bounded assistant text in the Jev state."),
    includeToolArguments: z
      .boolean()
      .default(DEFAULTS.privacy.includeToolArguments)
      .description("Include tool argument previews in the Jev state."),
    textChars: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.privacy.textChars)
      .description("Per-message user/assistant text budget in characters."),
  }),
  fallback: z.object({
    continueOnFailure: z
      .boolean()
      .default(DEFAULTS.fallback.continueOnFailure)
      .description("Fail-open: never block the agent loop on plugin failures."),
  }),
  diagnostics: z.object({
    logLevel: z
      .string()
      .default(DEFAULTS.diagnostics.logLevel)
      .description("Structured log level for plugin events."),
    includeCandidateScores: z
      .boolean()
      .default(DEFAULTS.diagnostics.includeCandidateScores)
      .description("Include per-candidate scores in reports."),
  }),
});

export default JevCompactionConfigSchema;
