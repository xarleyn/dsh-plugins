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

/** Monotonic execution decision shared by inherited, scoped and transport tools. */
export function qaToolDenial(
  allowed: ReadonlySet<string>,
  toolName: string,
): string | undefined {
  return allowed.has(toolName) ? undefined : TOOL_DENIAL;
}
