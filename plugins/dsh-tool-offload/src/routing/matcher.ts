/**
 * Tool-name pattern matching for routing config (SPEC §10.2, §32.1).
 *
 * Patterns are exact names or `prefix*` globs. Regex matching is deliberately
 * not supported: routing must stay deterministic and reviewable.
 */

export function matchesToolPattern(pattern: string, toolName: string): boolean {
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return pattern === toolName;
}

export function matchesAnyTool(patterns: readonly string[], toolName: string): boolean {
  return patterns.some((pattern) => matchesToolPattern(pattern, toolName));
}
