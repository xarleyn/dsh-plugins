const TOOL_DENIAL = "This tool is not available in the QA execution profile.";

/** Monotonic execution decision shared by inherited, scoped and transport tools. */
export function qaToolDenial(
  allowed: ReadonlySet<string>,
  toolName: string,
): string | undefined {
  return allowed.has(toolName) ? undefined : TOOL_DENIAL;
}
