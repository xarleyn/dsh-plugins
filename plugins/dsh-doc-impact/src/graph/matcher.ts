import type { DocImpactConfig, FileSelector, ImpactRule } from '../config/types.js';
import { createImpactFingerprint } from '../impact/fingerprint.js';
import type { Impact, ImpactSide } from '../impact/types.js';
import { materializeSelector, matchingFiles } from './selectors.js';
import { normalizeWorkspacePath, uniqueSorted } from '../utils/paths.js';

export interface MatchImpactsOptions {
  knownFiles?: Iterable<string>;
  detectedAt?: number;
}

function createImpact(
  rule: ImpactRule,
  triggerSide: ImpactSide,
  targetSide: ImpactSide,
  triggerSelector: FileSelector,
  targetSelector: FileSelector,
  changedFiles: string[],
  knownFiles: string[],
  detectedAt: number,
): Impact | undefined {
  const triggerFiles = matchingFiles(changedFiles, triggerSelector);
  if (triggerFiles.length === 0) return undefined;

  const targetFiles = materializeSelector(targetSelector, knownFiles);
  const changedTargets = matchingFiles(changedFiles, targetSelector);
  const status = changedTargets.length > 0 ? 'updated' : 'pending';
  const id = createImpactFingerprint(rule.id, triggerFiles, targetFiles);

  return {
    id,
    ruleId: rule.id,
    direction: rule.direction,
    triggerSide,
    targetSide,
    triggerFiles,
    targetFiles,
    relation: rule.relation,
    mode: rule.mode,
    status,
    detectedAt,
  };
}

export function matchImpacts(
  config: Pick<DocImpactConfig, 'rules'>,
  changedFilePaths: Iterable<string>,
  options: MatchImpactsOptions = {},
): Impact[] {
  const changedFiles = uniqueSorted([...changedFilePaths].map(normalizeWorkspacePath));
  const knownFiles = uniqueSorted([
    ...changedFiles,
    ...(options.knownFiles === undefined
      ? []
      : [...options.knownFiles].map(normalizeWorkspacePath)),
  ]);
  const detectedAt = options.detectedAt ?? Date.now();
  const impacts: Impact[] = [];

  for (const rule of config.rules) {
    if (!rule.enabled) continue;

    if (rule.direction === 'code-to-docs' || rule.direction === 'bidirectional') {
      const impact = createImpact(
        rule,
        'code',
        'docs',
        rule.code,
        rule.docs,
        changedFiles,
        knownFiles,
        detectedAt,
      );
      if (impact !== undefined) impacts.push(impact);
    }

    if (rule.direction === 'docs-to-code' || rule.direction === 'bidirectional') {
      const impact = createImpact(
        rule,
        'docs',
        'code',
        rule.docs,
        rule.code,
        changedFiles,
        knownFiles,
        detectedAt,
      );
      if (impact !== undefined) impacts.push(impact);
    }
  }

  return impacts;
}
