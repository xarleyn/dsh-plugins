/**
 * dsh-git-readonly — read-only git provenance tools for DeepSeek Harness agents.
 *
 * The plugin registers four model-facing tools (`dsh_git_context`,
 * `dsh_git_history`, `dsh_git_show`, `dsh_git_blame`) that answer "what task
 * was this changed for" against the session repository without ever giving
 * the model a command line: every git invocation is a fixed argv built by
 * this plugin, hardened against repo-controlled config and ambient
 * environment, byte-capped and time-boxed (SPEC §1, §6).
 */

import { getPluginLogger } from '@yadsh/dsh-plugin-log';

import {
  GitReadonlyConfigSchema,
  resolveGitReadonlyConfig,
  type GitReadonlyConfig,
} from './config.js';
import { createGitBlameTool } from './tools/blame.js';
import { createGitContextTool } from './tools/context.js';
import { createGitHistoryTool } from './tools/history.js';
import { createGitShowTool } from './tools/show.js';
import type { GitToolDeps } from './tools/shared.js';

export {
  GIT_READONLY_DEFAULTS,
  GitReadonlyConfigSchema,
  resolveGitReadonlyConfig,
  type GitReadonlyConfig,
  type ResolvedGitReadonlyConfig,
} from './config.js';
export { GitToolError, type GitToolErrorCode } from './errors.js';
export { buildGitEnv, FORCED_ENV_VALUES, REMOVED_ENV_KEYS } from './git/env.js';
export {
  parseDecorations,
  parseFormatRecord,
  parseNumstat,
  parsePorcelainBlame,
  type BlameLine,
  type NumstatFile,
} from './git/format.js';
export { runGit, GIT_HARDENING_PREFIX, type GitRunOptions, type GitRunResult } from './git/runner.js';
export {
  canonicalizeCommit,
  requireSessionCwd,
  resolveRepositoryRoot,
  type ToolExec,
} from './git/repo.js';
export {
  clampLineRange,
  escapeRegExpLiteral,
  validateCommitOid,
  validateRepoRelativePath,
  validateSearchLiteral,
} from './git/validate.js';
export { silentPluginLogger, type PluginLoggerLike } from './logging.js';
export { createGitBlameTool, type GitBlameResult } from './tools/blame.js';
export { createGitContextTool, type GitContextResult } from './tools/context.js';
export { createGitHistoryTool, type GitHistoryResult } from './tools/history.js';
export { createGitShowTool, type GitShowResult } from './tools/show.js';
export type { GitToolDeps } from './tools/shared.js';

/** Cordis plugin name. */
export const name = 'dsh-git-readonly';

/** The tools service is the only required host service. */
export const inject = ['tools'] as const;

/** Schemastery configuration contract (Cordis fills it before `apply`). */
export const Config = GitReadonlyConfigSchema;

/** Structural view of the host surface the plugin needs. */
export interface GitToolsHost {
  tools: { register(definition: unknown): () => void };
}

/** Exact tool names this plugin registers (deployment allow-list contract). */
export const GIT_TOOL_NAMES: readonly string[] = [
  'dsh_git_context',
  'dsh_git_history',
  'dsh_git_show',
  'dsh_git_blame',
];

/**
 * Plugin entry: resolve config and register the four provenance tools.
 * Registrations are collected by the Cordis plugin scope; `enabled: false`
 * keeps the surface entirely absent instead of registering inert tools.
 */
export function apply(ctx: GitToolsHost, rawConfig?: GitReadonlyConfig): void {
  const config = resolveGitReadonlyConfig(rawConfig);
  const logger = getPluginLogger({ pluginId: 'dsh-git-readonly' });
  if (!config.enabled) {
    logger.info('plugin.disabled');
    return;
  }
  const deps: GitToolDeps = { config, logger };
  ctx.tools.register(createGitContextTool(deps));
  ctx.tools.register(createGitHistoryTool(deps));
  ctx.tools.register(createGitShowTool(deps));
  ctx.tools.register(createGitBlameTool(deps));
  logger.info('plugin.applied', { tools: [...GIT_TOOL_NAMES] });
}

export default { name, inject, Config, apply };
