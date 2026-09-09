/**
 * dsh-model-safety-gate — independent two-layer safety gate for DeepSeek
 * Harness.
 *
 * The Cordis entrypoint: registers `ctx.safetyGate`, the `agent/pre-step`
 * input gate, the `llm/stream` quarantine wrapper, the `tools/pre-execute`
 * tool gate, and the `tools/post-execute` injection guard (SPEC.md §1, §3).
 */

import { ModelSafetyGate } from "./service.js";

export { ModelSafetyGate, AuditRing, type SafetyGateServiceDeps, type SafetyGateInspect } from "./service.js";
export {
  SAFETY_GATE_DEFAULTS,
  ModelSafetyGateConfigSchema,
  resolveSafetyGateConfig,
  type ModelSafetyGateConfig,
  type ResolvedSafetyGateConfig,
  type ClassifierBackend,
  type FailureMode,
  type GateMode,
  type StreamMode,
} from "./config.js";
export {
  SafetyGateError,
  VERDICT_VERSION,
  DECISION_ORDER,
  SAFETY_CATEGORIES,
  QUALITY_CATEGORIES,
  type SafetyVerdict,
  type SafetyDecision,
  type SafetyCategory,
  type QualityCategory,
  type SafetyErrorCode,
  type ScanFinding,
  type ScanResult,
  type CheckDirection,
  type ContentChannel,
} from "./types.js";
export { SafetyScanner } from "./rules/scanner.js";
export { foldText, decodeEncodings } from "./rules/normalize.js";
export { INJECTION_RULES, compileInjectionRule } from "./rules/injection.js";
export { SECRET_RULES, findHighEntropyTokens, shannonEntropy } from "./rules/secrets.js";
export { mergeL0L1, mergeDecisions, applyGateMode, decisionForCategories } from "./rules/policy.js";
export { CheckPipeline, POLICY_VERSION, type PipelineCheckInput, type PipelineCheckResult } from "./pipeline.js";
export { SafetyClassifierService, createOpenAiCompatibleTransport, createDshClassifierTransport } from "./classifier/index.js";
export { isSafetyInternal, runIsolated } from "./classifier/isolation.js";
export { validateVerdict, extractJsonPayload } from "./classifier/schema.js";
export { buildClassifierPrompt, CLASSIFIER_SYSTEM_PROMPT } from "./classifier/prompt.js";
export { SAFETY_EVENT_TYPES, buildAuditEvent, type SafetyAuditEvent } from "./audit/events.js";
export { SafetyMetrics, type SafetyMetricsSnapshot } from "./audit/metrics.js";
export { contentSha256, rawPreview } from "./audit/sanitizer.js";
export { createInputGuard, extractMessagesText } from "./guards/input.js";
export { guardOutputStream } from "./guards/output-stream.js";
export { createPreExecuteGuard, serializeToolArguments } from "./guards/tools.js";
export { createPostExecuteGuard, extractResultText } from "./guards/tool-results.js";
export { TurnRiskTracker } from "./guards/risk-state.js";
export { ChannelQuarantine, PassThroughMonitor, ReleasedTail } from "./stream/quarantine.js";
export { cancelTurn } from "./stream/cancellation.js";
export { isDeltaChunk, blockedFinish, type StreamChunk } from "./stream/chunks.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Inspect and steer the safety gate without touching internals. */
    safetyGate: ModelSafetyGate;
  }
}

export default ModelSafetyGate;
