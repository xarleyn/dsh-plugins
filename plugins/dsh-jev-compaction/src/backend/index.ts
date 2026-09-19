/**
 * Backend-mode entry (`@yadsh/dsh-jev-compaction/backend`, SPEC §6.6): mount
 * this default export as the profile's compaction engine instead of
 * `@deepseek-ai/dsh-compaction-basic`. Semantic Jev pruning runs at the early
 * threshold; the inherited basic engine provides the conventional summary
 * fallback, `/compact`, and overflow recovery above `summaryRatio`.
 */

import { JevCompactionEngine } from "./engine.js";

export { JevCompactionEngine };
export { DEFAULT_SUMMARY_RATIO, resolveJevEngineConfig } from "./config.js";
export type { JevEngineConfig, ResolvedJevEngineParts } from "./config.js";

/** The profile-row plugin entry. */
export default JevCompactionEngine;
