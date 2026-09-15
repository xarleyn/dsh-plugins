const TOOL_DENIAL = "This tool is not available in the QA execution profile.";

export interface QaToolPolicyPlan {
  /** Exact names that must remain visible after the scoped restriction. */
  readonly allow: readonly string[];
  /** Configured names absent from the agent's composed tool view. */
  readonly unknown: readonly string[];
}

/**
 * Validate an allow-list against the complete agent-scoped view.
 *
 * Preset tools live on an ancestor scope, not necessarily in the global tool
 * layer. The restriction must therefore retain the configured names verbatim;
 * deriving it from the global view would hide every preset-owned tool after a
 * successful first attestation and make the next attestation fail.
 */
export function qaToolPolicyPlan(
  allow: readonly string[],
  isMounted: (toolName: string) => boolean,
): QaToolPolicyPlan {
  return {
    allow: [...allow],
    unknown: allow.filter((toolName) => !isMounted(toolName)),
  };
}

/**
 * Monotonic execution decision shared by inherited, scoped and transport tools.
 * @param allowed - the operator's configured allow-list for this agent.
 * @param toolName - the tool the model is trying to call.
 * @param dynamicNames - names this plugin attached for the calling agent after
 *   a successful skill load. They are deliberately absent from the allow-list:
 *   that list is validated against the mounted catalog at attestation time, and
 *   a tool that appears only later cannot be named there without failing the
 *   check. The guard is therefore where they are authorized — a dynamic tool
 *   stays as unchecked as any allow-listed one, and no less.
 */
export function qaToolDenial(
  allowed: ReadonlySet<string>,
  toolName: string,
  dynamicNames: readonly string[] = [],
): string | undefined {
  return allowed.has(toolName) || dynamicNames.includes(toolName)
    ? undefined
    : TOOL_DENIAL;
}
