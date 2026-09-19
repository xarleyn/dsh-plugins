/**
 * Configuration of the backend-mode engine entry (SPEC §38 Track B, §6.6).
 *
 * The engine entry accepts the full companion plugin configuration (the early
 * semantic-prune threshold is `trigger.contextRatio`, called `jevPruneRatio`
 * in the SPEC) plus the summary-side knobs it forwards to the inherited
 * `BasicCompactionEngine` — `summaryRatio` maps to basic's
 * `thresholdRatio`. Validation is strict and happens in
 * `resolveJevEngineConfig` at construction; the cordis `Config` schema of the
 * engine entry is deliberately `z.any()` because the inherited basic schema
 * would strip the companion sections before they reach the constructor.
 */

import type { ModelCompactPolicyConfig } from "@deepseek-ai/dsh-compaction-basic";

import {
  resolveJevCompactionConfig,
  type JevCompactionConfig,
  type ResolvedJevCompactionConfig,
} from "../config.js";

/** Keys the engine consumes itself; everything else belongs to the prune service. */
const ENGINE_ONLY_KEYS = new Set([
  "summaryRatio",
  "auto",
  "retainRatio",
  "retainTokens",
  "summarizationProvider",
  "summarizationModel",
  "maxTokens",
  "compactionRetries",
  "maxOverflowRetries",
  "modelPolicies",
]);

/** Default summary threshold — strictly above the early-prune default of 0.70. */
export const DEFAULT_SUMMARY_RATIO = 0.82;

/** Engine entry configuration: companion config plus the summary-side knobs. */
export interface JevEngineConfig extends JevCompactionConfig {
  /**
   * Conventional summary threshold forwarded to the inherited basic engine as
   * its `thresholdRatio`. Must be strictly greater than
   * `trigger.contextRatio` (the early Jev-prune threshold).
   */
  readonly summaryRatio?: number;
  /** Register the inherited automatic listeners (default true). */
  readonly auto?: boolean;
  /** Verbatim-tail fraction forwarded to the basic engine. */
  readonly retainRatio?: number;
  /** Absolute verbatim-tail budget forwarded to the basic engine. */
  readonly retainTokens?: number;
  /** Summarization route override forwarded to the basic engine. */
  readonly summarizationProvider?: string;
  readonly summarizationModel?: string;
  /** Summary call token cap forwarded to the basic engine. */
  readonly maxTokens?: number;
  /** Summary retry budget forwarded to the basic engine. */
  readonly compactionRetries?: number;
  /** Overflow recovery retry budget forwarded to the basic engine. */
  readonly maxOverflowRetries?: number;
  /** Per-route policy overrides forwarded to the basic engine (validated there). */
  readonly modelPolicies?: ModelCompactPolicyConfig[];
}

/** The split configuration parts. */
export interface ResolvedJevEngineParts {
  /** Engine-level facts (diagnostics). */
  readonly engine: {
    readonly summaryRatio: number;
    readonly auto: boolean;
  };
  /** Normalized configuration for the inherited basic engine. */
  readonly basic: Record<string, unknown>;
  /** Validated companion configuration for the nested prune service. */
  readonly companion: ResolvedJevCompactionConfig;
  /** The raw companion-shaped config (for the service constructor). */
  readonly companionRaw: JevCompactionConfig;
}

function clampProbability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`jev-compaction: ${label} must be within [0, 1]`);
  }
  return value;
}

/**
 * Split and validate the engine configuration: companion sections resolve
 * through the shared plugin resolver, the summary threshold is validated
 * against the early-prune threshold, and the basic-side knobs are collected
 * into the object handed to the inherited constructor.
 */
export function resolveJevEngineConfig(
  raw: JevEngineConfig = {},
): ResolvedJevEngineParts {
  const summaryRatio = clampProbability(
    raw.summaryRatio ?? DEFAULT_SUMMARY_RATIO,
    "summaryRatio",
  );
  const auto = raw.auto ?? true;

  const companionRaw: JevCompactionConfig = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ENGINE_ONLY_KEYS.has(key) && value !== undefined) {
      (companionRaw as Record<string, unknown>)[key] = value;
    }
  }
  const companion = resolveJevCompactionConfig(companionRaw);
  if (summaryRatio <= companion.trigger.contextRatio) {
    throw new TypeError(
      `jev-compaction: summaryRatio (${summaryRatio}) must be greater than ` +
        `trigger.contextRatio (${companion.trigger.contextRatio}) — the early ` +
        "Jev prune must run before the conventional summary",
    );
  }

  const basic: Record<string, unknown> = {
    thresholdRatio: summaryRatio,
    auto,
    ...(raw.retainRatio === undefined ? {} : { retainRatio: raw.retainRatio }),
    ...(raw.retainTokens === undefined
      ? {}
      : { retainTokens: raw.retainTokens }),
    ...(raw.summarizationProvider === undefined
      ? {}
      : { summarizationProvider: raw.summarizationProvider }),
    ...(raw.summarizationModel === undefined
      ? {}
      : { summarizationModel: raw.summarizationModel }),
    ...(raw.maxTokens === undefined ? {} : { maxTokens: raw.maxTokens }),
    ...(raw.compactionRetries === undefined
      ? {}
      : { compactionRetries: raw.compactionRetries }),
    ...(raw.maxOverflowRetries === undefined
      ? {}
      : { maxOverflowRetries: raw.maxOverflowRetries }),
    ...(raw.modelPolicies === undefined
      ? {}
      : { modelPolicies: raw.modelPolicies }),
  };

  return {
    engine: { summaryRatio, auto },
    basic,
    companion,
    companionRaw,
  };
}
