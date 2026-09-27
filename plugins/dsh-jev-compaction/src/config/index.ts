/**
 * Configuration surface of the dsh-jev-compaction plugin.
 *
 * The Schemastery schema (`JevCompactionConfigSchema`) is the user-facing
 * contract exposed through the Cordis `Config` convention on the service;
 * `resolveJevCompactionConfig` normalizes raw config into fully defaulted,
 * clamped values, so the planner and the Jev client never see optional
 * fields or unsafe limits. Field semantics follow the plugin SPEC §22.
 *
 * The surface is split across the modules below and re-exported here unchanged:
 * `constants.ts` (presets and literal unions), `types.ts` (raw, resolved and
 * live shapes), `defaults.ts` (shipped values), `validation.ts` (clamping
 * primitives), `resolve.ts` (normalization), `live.ts` (volatile references)
 * and `schema.ts` (the schema).
 */

export {
  ARCHIVE_FAILURE_POLICIES,
  DEFAULT_SHAPE_TOOLS,
  SHAPING_KINDS,
  SYSTEM_ONE_PRESETS,
  SYSTEM_ONE_PROVIDERS,
} from "./constants.js";
export { DEFAULTS } from "./defaults.js";
export { plainJevCompactionConfig } from "./live.js";
export { resolveJevCompactionConfig } from "./resolve.js";
export { JevCompactionConfigSchema } from "./schema.js";
export type {
  ArchiveFailurePolicy,
  ShapingKind,
  SystemOneProvider,
} from "./constants.js";
export type {
  JevCompactionConfig,
  JevCompactionLiveConfig,
  ResolvedJevCompactionConfig,
  SystemOneProviderOverride,
} from "./types.js";
export { default } from "./schema.js";
