/**
 * Public entrypoint of `@yadsh/dsh-jev-compaction`.
 *
 * Jev-powered, replay-safe semantic pruning of stale tool results: user,
 * system and assistant text stays verbatim; selected historical `tool/result`
 * surface nodes are shortened through DSH single-node surface replacements
 * while the original events remain in the append-only session log.
 */

import { JevCompactionService } from "./service.js";

export {
  DEFAULTS,
  JevCompactionConfigSchema,
  resolveJevCompactionConfig,
} from "./config.js";
export type {
  JevCompactionConfig,
  ResolvedJevCompactionConfig,
} from "./config.js";
export { JevCompactionService } from "./service.js";
export type { JevRunMode, JevRunReport, JevSkipReason } from "./service.js";
export { SurfaceChangedError } from "./mutation/apply.js";
export type { ApplyOutcome, AppliedEntry } from "./mutation/apply.js";
export {
  renderStub,
  renderTruncated,
  codePointLength,
} from "./mutation/render.js";
export {
  JevApiKeyMissingError,
  JevTransportError,
  SystemOneClient,
} from "./jev/backend.js";
export {
  SYSTEM_ONE_PRESETS,
  SYSTEM_ONE_PROVIDERS,
  type SystemOneProvider,
  type SystemOneProviderOverride,
} from "./config.js";
export type {
  SystemOneBackend,
  JevAnswers,
  JevQuestion,
  JevState,
} from "./jev/types.js";
export {
  JevInvalidResponseError,
  validateJevResponse,
} from "./jev/validate.js";
export { collectCandidates } from "./planner/collect.js";
export type { ToolResultCandidate } from "./planner/collect.js";
export { extractFeatures } from "./planner/features.js";
export type { CandidateFeatures } from "./planner/features.js";
export { decideAction } from "./planner/policy.js";
export type { CandidateScores, PruneAction } from "./planner/policy.js";
export { estimateSavings, meetsSavingsGate } from "./planner/savings.js";
export { buildPlan } from "./planner/plan.js";
export type { JevCompactionPlan, PlanItem } from "./planner/plan.js";
export { buildState, fitState } from "./jev/state.js";
export { batchCandidates, mapWithConcurrency } from "./jev/batch.js";
export { questionsFor } from "./jev/questions.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    jevCompaction: JevCompactionService;
  }
}

/** The plugin's service class (the bundle default export). */
export default JevCompactionService;
export type { JevCompactionConfig as Config } from "./config.js";
