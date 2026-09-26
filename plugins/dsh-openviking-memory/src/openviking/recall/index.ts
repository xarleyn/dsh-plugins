/**
 * Public face of the recall subsystem.
 *
 * The implementation is split by the reason each part changes: what is asked of
 * the memory backend (`request-body.ts`, `source-search.ts`,
 * `server-assembled.ts`), which of the hits the turn is shown (`rank.ts`), how
 * they are rendered into the prompt (`format.ts`), and what one turn leaves on
 * disk for the next (`state-files.ts`); `pipeline.ts` decides the order those
 * run in, and `types.ts` carries the vocabulary they share.
 *
 * The stages import each other directly rather than through this file, so the
 * assembly order stays a dependency of the parts, not the other way round.
 * Everything listed here is exactly what the single module exported before the
 * split.
 */
export { estimateTokens } from "./format.js";
export {
  buildRecallEndpointBody,
  buildContextSearchBody,
  contextRequestTimeoutMs,
} from "./request-body.js";
export {
  isContextFaceLegacy,
  markContextFaceLegacy,
  peerScopeMemoPath,
  readPeerScopeDowngrade,
  markPeerScopeDowngrade,
} from "./state-files.js";
export { fetchAssembledContext, postRecall } from "./server-assembled.js";
export { buildRecallBlock } from "./pipeline.js";
export type { FetchJSON, FetchJSONResult, RecallConfig } from "./types.js";
