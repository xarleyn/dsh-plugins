/**
 * `resolveJevCompactionConfig`: normalizes raw config into fully defaulted,
 * clamped values, including the decision-backend endpoint resolution and the
 * legacy flat `jev` override. The planner and the Jev client never see optional
 * fields or unsafe limits. Field semantics follow the plugin SPEC §18, §22.
 */

import { SYSTEM_ONE_PRESETS, SYSTEM_ONE_PROVIDERS } from "./constants.js";
import { DEFAULTS } from "./defaults.js";
import {
  clampInt,
  clampProbability,
  resolveArchivePolicy,
  resolveLevel,
  resolveToolList,
} from "./validation.js";
import type {
  JevCompactionConfig,
  ResolvedJevCompactionConfig,
  SystemOneProviderOverride,
} from "./types.js";

/**
 * The legacy flat `jev` block, minus the values the settings layer materializes
 * from the shipped defaults.
 *
 * The legacy block stays an override for deployments that wrote it — but the
 * settings service hands the resolver a value with every default filled in, so
 * a key equal to its shipped default means "nobody configured this" rather than
 * "the deployment chose it". Honouring those would shadow
 * `decision.<provider>` — the shape the README documents and the profiles use —
 * on every deployment, which is how a self-hosted `jeff` deployment ended up
 * asking for `TYPESAFE_API_KEY` and never reached its own scorer.
 */
function legacyOverride(
  raw: JevCompactionConfig,
  key: "model" | "apiKeyEnv" | "baseUrl",
): string | undefined {
  const value = raw.jev?.[key];
  if (value === undefined || value === DEFAULTS.jev[key]) return undefined;
  return value;
}

/**
 * Resolve the decision backend endpoint: pick the provider preset, layer the
 * `decision.<provider>` overrides on top, then let an explicitly configured
 * legacy flat `jev` block override one-for-one. `provider: custom` must carry
 * an explicit `baseUrl` — a misconfigured endpoint must fail loudly at
 * startup, not silently prune or score against the wrong service.
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
    model: legacyOverride(raw, "model") ?? override?.model ?? preset.model,
    apiKeyEnv:
      legacyOverride(raw, "apiKeyEnv") ??
      override?.apiKeyEnv ??
      preset.apiKeyEnv,
    baseUrl:
      legacyOverride(raw, "baseUrl") ?? override?.baseUrl ?? preset.baseUrl,
  };
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
