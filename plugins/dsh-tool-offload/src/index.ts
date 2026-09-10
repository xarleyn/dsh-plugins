/**
 * dsh-tool-offload — offloads large, low-judgement tool results to small
 * one-shot worker agents before they enter the main model context.
 *
 * The Cordis entrypoint: registers `ctx.toolOffload` and the
 * `tools/post-execute` listener that routes eligible successful textual
 * results to a cheap no-tools worker (SPEC §3.1). The original tool executes
 * normally under the parent's permissions; only the model-facing content of
 * qualifying results is replaced, and every failure falls back to the
 * original result (SPEC §22).
 */

import { ToolOffloadService } from "./service.js";

export { ToolOffloadService, type ToolOffloadServiceDeps, type ToolOffloadStats } from "./service.js";
export {
  TOOL_OFFLOAD_DEFAULTS,
  ToolOffloadConfigSchema,
  resolveToolOffloadConfig,
  type OffloadRuleConfig,
  type ResolvedOffloadRule,
  type ResolvedToolOffloadConfig,
  type ToolOffloadConfig,
  type WorkerProfileConfig,
} from "./config.js";
export { OffloadError, type OffloadErrorCode } from "./errors.js";
export { BUNDLED_PROMPT_PROFILES } from "./prompts/profiles.js";
export { matchesAnyTool, matchesToolPattern } from "./routing/matcher.js";
export { decideRoute, type OffloadSkipReason, type RouteDecision } from "./routing/policy.js";
export { inspectResult, serializeArgs, type OffloadCandidate } from "./routing/inspect-result.js";
export { extractParentTask } from "./context/parent-context.js";
export { buildWorkerPrompt, type WorkerPayloadInput } from "./worker/payload.js";
export {
  WORKER_LABEL_PREFIX,
  createSubagentRunner,
  joinTextBlocks,
  type SubagentsServiceLike,
  type WorkerOutcome,
  type WorkerRunRequest,
  type WorkerRunnerLike,
} from "./worker/runner.js";
export { validateWorkerOutput, type WorkerValidation } from "./worker/validate.js";
export { buildFallbackText, type FallbackMode } from "./fallback/fallback.js";
export { deriveOffloadMetrics, OffloadCounters, type OffloadCounterSnapshot, type OffloadDerivedMetrics } from "./telemetry/counters.js";
export { OFFLOAD_ANNOTATION_MARKER, createPostExecuteListener, type ToolOffloadListener } from "./integration/post-execute.js";
export { Semaphore, KeyedLimiter } from "./utils/semaphore.js";
export { byteLength, estimateTokens, sanitizeBoundaryTags, truncateHead, truncateMiddle } from "./utils/text.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    toolOffload: ToolOffloadService;
  }
}

export default ToolOffloadService;
