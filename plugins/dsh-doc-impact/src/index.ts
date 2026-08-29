export { ConfigError } from './config/errors.js';
export { loadConfig, parseConfig } from './config/loader.js';
export { normalizeConfig, type ConfigFallbacks } from './config/normalize.js';
export {
  CHANGE_DETECTION_MODES,
  DIRECTIONS,
  RELATIONS,
  RESOLUTION_MODES,
  SCOPES,
} from './config/types.js';
export type {
  ChangeDetectionMode,
  Direction,
  DocImpactConfig,
  DocImpactDefaults,
  FileSelector,
  ImpactRule,
  Relation,
  ResolutionMode,
  Scope,
} from './config/types.js';
export { createDetector } from './changes/detector.js';
export { createFilesystemDetector } from './changes/filesystem-detector.js';
export { createGitDetector } from './changes/git-detector.js';
export type {
  ChangeDetector,
  ChangeDiff,
  DetectorOptions,
  FileChange,
  FileSnapshot,
  TurnBaseline,
} from './changes/types.js';
export { matchImpacts } from './graph/matcher.js';
export type { MatchImpactsOptions } from './graph/matcher.js';
export {
  isGlobPattern,
  matchesSelector,
  matchingFiles,
  materializeSelector,
} from './graph/selectors.js';
export { createImpactFingerprint } from './impact/fingerprint.js';
export { autoResolveImpact, ResolutionError, resolveImpact } from './impact/resolution.js';
export { ImpactState } from './impact/state.js';
export type { ImpactStateOptions } from './impact/state.js';
export { IMPACT_STATUSES } from './impact/types.js';
export type {
  Impact,
  ImpactSide,
  ImpactStatus,
  ResolveImpactInput,
} from './impact/types.js';
export { DocImpactEngine } from './engine/runtime.js';
export type {
  EngineLogger,
  EngineOptions,
  EngineSafety,
  EngineWorkspaceConfig,
  ResolveOutcome,
  StopDecision,
} from './engine/runtime.js';
export {
  buildLimitMessage,
  buildReminderMessage,
  formatChanged,
  formatExplain,
  formatStatus,
} from './engine/reminder.js';
export type { Attribution } from './engine/reminder.js';
export { normalizeWorkspacePath, uniqueSorted } from './utils/paths.js';
export { hashFile, hashString } from './utils/hashing.js';

// DSH adapter — the installable plugin entry point. The pure engine above has
// no harness dependencies; only this block imports @deepseek-ai packages.
export { apply, name, inject } from './dsh/plugin.js';
export { resolvePluginConfig } from './dsh/plugin-config.js';
export type { DocImpactPluginConfig } from './dsh/plugin-config.js';
export { createWorkspaceConfigSource } from './dsh/config-source.js';
export { currentTurnNumber, registerLifecycle } from './dsh/lifecycle.js';
export { createResolveTool, createStatusTool } from './dsh/tools.js';
export { createDocImpactCommand } from './dsh/commands.js';
