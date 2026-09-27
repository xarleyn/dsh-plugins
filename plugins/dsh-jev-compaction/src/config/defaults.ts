/**
 * The shipped default configuration, built from the provider presets and the
 * default shaped-tool list. Values mirror the SPEC §22 suggested values.
 */

import { DEFAULT_SHAPE_TOOLS, SYSTEM_ONE_PRESETS } from "./constants.js";
import type { ResolvedJevCompactionConfig } from "./types.js";

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
