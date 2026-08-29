import type { Impact, ResolveImpactInput } from './types.js';
import { normalizeWorkspacePath } from '../utils/paths.js';

export class ResolutionError extends Error {
  constructor(message: string) {
    super(`dsh-doc-impact: ${message}`);
    this.name = 'ResolutionError';
  }
}

function targetWasChanged(impact: Impact, changedFiles: Set<string>): boolean {
  return impact.targetFiles.some((target) => changedFiles.has(target));
}

export function autoResolveImpact(
  impact: Impact,
  changedFilePaths: Iterable<string>,
): Impact {
  if (impact.status !== 'pending') return impact;
  const changedFiles = new Set([...changedFilePaths].map(normalizeWorkspacePath));
  return targetWasChanged(impact, changedFiles)
    ? { ...impact, status: 'updated' }
    : impact;
}

export function resolveImpact(
  impact: Impact,
  input: ResolveImpactInput,
  changedFilePaths: Iterable<string>,
): Impact {
  if (input.ruleId !== impact.ruleId) {
    throw new ResolutionError(
      `resolution rule ${JSON.stringify(input.ruleId)} does not match impact rule ${JSON.stringify(impact.ruleId)}`,
    );
  }
  if (impact.status !== 'pending') {
    throw new ResolutionError(`impact ${impact.id} is already ${impact.status}`);
  }
  if (input.status === 'not-applicable' && input.reason?.trim().length === 0) {
    throw new ResolutionError('not-applicable resolution requires a non-empty reason');
  }
  if (input.status === 'not-applicable' && input.reason === undefined) {
    throw new ResolutionError('not-applicable resolution requires a non-empty reason');
  }
  if (input.status === 'updated') {
    const changedFiles = new Set([...changedFilePaths].map(normalizeWorkspacePath));
    if (!targetWasChanged(impact, changedFiles)) {
      throw new ResolutionError('updated resolution requires a changed target file');
    }
  }

  const resolved: Impact = { ...impact, status: input.status };
  if (input.reason !== undefined) resolved.reason = input.reason.trim();
  return resolved;
}
