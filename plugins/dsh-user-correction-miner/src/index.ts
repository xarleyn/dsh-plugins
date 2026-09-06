export { Config, DEFAULT_CONFIG, resolveConfig } from "./config.js";
export type {
  ResolvedUserCorrectionMinerConfig,
  UserCorrectionMinerConfig,
} from "./config.js";
export * from "./types.js";
export { CorrectionMinerEngine } from "./mining/engine.js";
export type { MinerLogger, SessionSourceLike } from "./mining/engine.js";
export { prefilterCorrection } from "./mining/prefilter.js";
export type { CorrectionPrefilterResult } from "./mining/prefilter.js";
export { extractCorrectionEvidence } from "./mining/context-extractor.js";
export { scanSession } from "./mining/scanner.js";
export type { SessionScanResult, SessionSnapshot } from "./mining/scanner.js";
export {
  CORRECTION_MINER_DOMAIN,
  DomainCorrectionStore,
  MemoryCorrectionStore,
} from "./dsh/storage.js";
export { createSessionSource, SessionSource } from "./dsh/sessions.js";
export { createCorrectionsCommand } from "./dsh/commands.js";
export { apply, inject, name } from "./dsh/plugin.js";
