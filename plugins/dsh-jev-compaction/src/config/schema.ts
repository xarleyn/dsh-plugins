/**
 * The Schemastery schema (`JevCompactionConfigSchema`) — the user-facing
 * contract exposed through the Cordis `Config` convention on the service. Every
 * default and range here mirrors `defaults.ts` and `constants.ts`; the runtime
 * clamping lives in `resolve.ts`. Field semantics follow the plugin SPEC §22.
 */

import z from "@deepseek-ai/schemastery";
import { ARCHIVE_FAILURE_POLICIES } from "./constants.js";
import { DEFAULTS } from "./defaults.js";

/** Schemastery schema exposed through the service's static `Config`. */
export const JevCompactionConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(DEFAULTS.enabled)
    .volatile()
    .description("Enable Jev compaction."),
  decision: z.object({
    provider: z
      .string()
      .default(DEFAULTS.decision.provider)
      .volatile()
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
      .volatile()
      .description("Jev decision model (legacy override; prefer decision)."),
    apiKeyEnv: z
      .string()
      .default(DEFAULTS.jev.apiKeyEnv)
      .volatile()
      .description(
        "Environment variable that holds the API key (legacy override; prefer decision).",
      ),
    baseUrl: z
      .string()
      .default(DEFAULTS.jev.baseUrl)
      .volatile()
      .description("Jev endpoint (legacy override; prefer decision)."),
    timeoutMs: z
      .number()
      .min(500)
      .max(60_000)
      .step(1)
      .default(DEFAULTS.jev.timeoutMs)
      .volatile()
      .description("Per-request timeout in ms."),
    maxConcurrency: z
      .number()
      .min(1)
      .max(8)
      .step(1)
      .default(DEFAULTS.jev.maxConcurrency)
      .volatile()
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
      .volatile()
      .description("Context-window fraction that arms automatic pruning."),
    minSurfaceTokens: z
      .number()
      .min(1)
      .step(1)
      .default(DEFAULTS.trigger.minSurfaceTokens)
      .volatile()
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
      .volatile()
      .description("Newest surface positions never touched."),
    recentTokens: z
      .number()
      .min(0)
      .step(1)
      .default(DEFAULTS.preserve.recentTokens)
      .volatile()
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
      .volatile()
      .description("needContents at or above this keeps the result full."),
    truncateThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(DEFAULTS.decisions.truncateThreshold)
      .volatile()
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
      .volatile()
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
        .volatile()
        .description(
          "Immediate semantic shaping of large tool outputs before they are persisted.",
        ),
      includeTools: z
        .array(z.string())
        .default([...DEFAULTS.resultShaping.includeTools])
        .volatile()
        .description("Tools whose results may be shaped."),
      excludeTools: z
        .array(z.string())
        .default([...DEFAULTS.resultShaping.excludeTools])
        .volatile()
        .description(
          "Tools whose results are never shaped; wins over the allowlist.",
        ),
      thresholdChars: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.thresholdChars)
        .volatile()
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
        .volatile()
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
        .volatile()
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
        .volatile()
        .description("Head lines pinned from collapsing."),
      keepTailLines: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.keepTailLines)
        .volatile()
        .description("Tail lines pinned from collapsing."),
      minClassificationConfidence: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULTS.resultShaping.minClassificationConfidence)
        .volatile()
        .description("Minimum confidence to act on a classification."),
      minSavingsChars: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.resultShaping.minSavingsChars)
        .volatile()
        .description("Skip shaping below this many saved characters."),
      minSavingsRatio: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULTS.resultShaping.minSavingsRatio)
        .volatile()
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
        .volatile()
        .description("Archive the original rendered result before shaping it."),
      rootPath: z
        .string()
        .default(DEFAULTS.archive.rootPath)
        .volatile()
        .description(
          "Archive root; empty resolves under the harness home data directory.",
        ),
      retentionDays: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.archive.retentionDays)
        .volatile()
        .description("Retention window in days; 0 keeps entries forever."),
      maxBytes: z
        .number()
        .min(0)
        .step(1)
        .default(DEFAULTS.archive.maxBytes)
        .volatile()
        .description("Retention ceiling in bytes; 0 disables the size cap."),
      deduplicate: z
        .boolean()
        .default(DEFAULTS.archive.deduplicate)
        .description("Reuse content-addressed entries instead of duplicating."),
      onFailure: z
        .union([...ARCHIVE_FAILURE_POLICIES])
        .default(DEFAULTS.archive.onFailure)
        .volatile()
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
      .volatile()
      .description("Structured log level for plugin events."),
    includeCandidateScores: z
      .boolean()
      .default(DEFAULTS.diagnostics.includeCandidateScores)
      .description("Include per-candidate scores in reports."),
  }),
});

export default JevCompactionConfigSchema;
