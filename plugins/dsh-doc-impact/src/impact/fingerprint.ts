import { createHash } from 'node:crypto';
import { uniqueSorted } from '../utils/paths.js';

export function createImpactFingerprint(
  ruleId: string,
  triggerFiles: Iterable<string>,
  targetFiles: Iterable<string>,
): string {
  const serialized = JSON.stringify([
    ruleId,
    uniqueSorted(triggerFiles),
    uniqueSorted(targetFiles),
  ]);
  return createHash('sha256').update(serialized).digest('hex');
}
