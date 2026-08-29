import picomatch from 'picomatch';
import type { FileSelector } from '../config/types.js';
import { normalizeWorkspacePath, uniqueSorted } from '../utils/paths.js';

const GLOB_MAGIC = /[*?{}()[\]!+@]/u;

export function isGlobPattern(pattern: string): boolean {
  return GLOB_MAGIC.test(pattern);
}

function patternMatches(path: string, pattern: string): boolean {
  if (!isGlobPattern(pattern)) {
    return path === pattern || path.startsWith(`${pattern}/`);
  }
  return picomatch.isMatch(path, pattern, { dot: true });
}

export function matchesSelector(filePath: string, selector: FileSelector): boolean {
  const path = normalizeWorkspacePath(filePath);
  const included = selector.include.some((pattern) => patternMatches(path, pattern));
  if (!included) return false;
  return !selector.exclude.some((pattern) => patternMatches(path, pattern));
}

export function matchingFiles(
  filePaths: Iterable<string>,
  selector: FileSelector,
): string[] {
  const normalized = [...filePaths].map(normalizeWorkspacePath);
  return uniqueSorted(normalized.filter((path) => matchesSelector(path, selector)));
}

export function materializeSelector(
  selector: FileSelector,
  knownFiles: Iterable<string>,
): string[] {
  const matches = matchingFiles(knownFiles, selector);
  const literalTargets = selector.include.filter(
    (pattern) => !isGlobPattern(pattern) && matchesSelector(pattern, selector),
  );
  return uniqueSorted([...matches, ...literalTargets]);
}
