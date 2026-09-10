/**
 * dsh-cas-results — content-addressed offload store for bulky tool results.
 *
 * The Cordis entrypoint: registers `ctx.casResults`, the `tools/post-execute`
 * result-reshaping listener, and the `dsh_cas_*` retrieval tools. Large
 * successful tool results are stored once by SHA-256, the session keeps only
 * a bounded deterministic preview plus a stable reference, and the agent can
 * retrieve or search the original on demand (SPEC §1, §36).
 */

import { CasResultsService } from "./service.js";

export { CasResultsService, resolveStoreDir, type CasResultsServiceDeps, type CasResultsStats } from "./service.js";
export { FilesystemCasStore } from "./cas/filesystem-store.js";
export { CasError, type CasErrorCode } from "./cas/errors.js";
export {
  CAS_RESULTS_DEFAULTS,
  CasResultsConfigSchema,
  resolveCasResultsConfig,
  type CasResultsConfig,
  type ResolvedCasResultsConfig,
  type ToolOverrideConfig,
} from "./config.js";
export type {
  CasStore,
  CasMetadata,
  CasObject,
  CasKind,
  CasPutInput,
  CasReadOptions,
  CasReadResult,
  CasSearchQuery,
  CasSearchResult,
  CasStoreStats,
  CasGcOptions,
  CasGcResult,
} from "./cas/types.js";
export { decodeBase64Candidate } from "./transform/base64.js";
export { classifyText, sniffBinaryMediaType } from "./transform/classify.js";
export { transformValue, type JsonValue, type TransformPolicy, type TransformOutcome, type ValueReplacement } from "./transform/scan-value.js";
export { isCasMarkerText, formatBytes, formatMarkerHeader, formatRetrieveHint } from "./transform/marker.js";
export { CasCounters, deriveCasMetrics, type CasCounterSnapshot } from "./observability/counters.js";
export { isOwnToolName, resolveToolPolicy } from "./integration/policies.js";
export { createPostExecuteListener, type CasPostExecuteListener } from "./integration/post-execute.js";
export { createRetrieveTool } from "./tools/retrieve.js";
export { createSearchTool } from "./tools/search.js";
export { createInfoTool } from "./tools/info.js";
export { createStatsTool } from "./tools/stats.js";
export { createGcTool } from "./tools/gc.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    casResults: CasResultsService;
  }
}

export default CasResultsService;
