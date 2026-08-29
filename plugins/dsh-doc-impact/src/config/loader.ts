import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { ConfigError } from './errors.js';
import { normalizeConfig, type ConfigFallbacks } from './normalize.js';
import type { DocImpactConfig } from './types.js';

export function parseConfig(source: string, fallbacks?: ConfigFallbacks): DocImpactConfig {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`invalid YAML: ${message}`);
  }
  return normalizeConfig(value, fallbacks);
}

export async function loadConfig(filePath: string, fallbacks?: ConfigFallbacks): Promise<DocImpactConfig> {
  return parseConfig(await readFile(filePath, 'utf8'), fallbacks);
}
