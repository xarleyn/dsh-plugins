import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { ConfigError } from '../config/errors.js';
import { parseConfig } from '../config/loader.js';
import type { EngineLogger, EngineWorkspaceConfig } from '../engine/runtime.js';
import type { DocImpactPluginConfig } from './plugin-config.js';

export type WorkspaceConfigSource = (cwd: string) => Promise<EngineWorkspaceConfig | undefined>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  /** Parsed result, or the failure message; both are cached until the file changes. */
  outcome: EngineWorkspaceConfig | { error: string };
}

function localOverridePath(configFile: string): string {
  return join(dirname(configFile), 'doc-impact.local.yml');
}

interface LocalOverrides {
  disabledRules: string[];
}

async function readLocalOverrides(path: string, logger: EngineLogger | undefined): Promise<LocalOverrides> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { disabledRules: [] };
  }
  try {
    // JSON is a YAML subset, so JSON override files parse here as well.
    const parsed: unknown = parse(raw);
    const list = (parsed as { disabledRules?: unknown } | null)?.disabledRules;
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      throw new ConfigError('disabledRules must be an array of rule IDs');
    }
    return { disabledRules: list as string[] };
  } catch (error) {
    logger?.warn(
      `dsh-doc-impact: ignoring malformed local overrides file ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
    return { disabledRules: [] };
  }
}

/**
 * Per-cwd workspace config source with mtime-based caching (SPEC §58):
 * `.dsh/doc-impact.yml` plus optional `.dsh/doc-impact.local.yml` overrides
 * (SPEC §38). Load failures are cached per file version, logged once, and
 * resolve to `undefined` (plugin inert) so agents never break because of a
 * broken config.
 */
export function createWorkspaceConfigSource(
  getPluginConfig: () => DocImpactPluginConfig,
  logger?: EngineLogger,
): WorkspaceConfigSource {
  const cache = new Map<string, CacheEntry>();

  return async function load(cwd: string): Promise<EngineWorkspaceConfig | undefined> {
    const plugin = getPluginConfig();
    const configPath = join(cwd, ...plugin.configFile.split('/'));
    let info;
    try {
      info = await stat(configPath);
    } catch {
      return undefined; // No workspace config → plugin inactive for this cwd.
    }
    if (!info.isFile()) return undefined;

    const cacheKey = `${cwd}\0${plugin.configFile}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return 'error' in cached.outcome ? undefined : cached.outcome;
    }

    try {
      const source = await readFile(configPath, 'utf8');
      const config = parseConfig(source, { mode: plugin.defaultsMode });
      const overrides = await readLocalOverrides(localOverridePath(configPath), logger);
      const disabled = new Set(overrides.disabledRules);
      const effective = {
        ...config,
        rules: config.rules.map((rule) => ({
          ...rule,
          enabled: rule.enabled && !disabled.has(rule.id),
        })),
      };
      const outcome: EngineWorkspaceConfig = {
        config: effective,
        safety: plugin.safety,
        maxSnapshotFiles: plugin.maxSnapshotFiles,
        debug: plugin.debug,
      };
      cache.set(cacheKey, { mtimeMs: info.mtimeMs, size: info.size, outcome });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error?.(`dsh-doc-impact: workspace config rejected, plugin inert until it is fixed\n${message}`);
      cache.set(cacheKey, { mtimeMs: info.mtimeMs, size: info.size, outcome: { error: message } });
      return undefined;
    }
  };
}
