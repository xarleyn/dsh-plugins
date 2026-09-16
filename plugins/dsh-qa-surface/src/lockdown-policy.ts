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

const CEILING_DENIAL =
  "This tool is outside the capability profile of this conversation, which also bounds its delegated assistants.";

/**
 * The conversation-wide ceiling, applied to every agent of an attested chat.
 *
 * A scoped restriction and a scoped guard cover the scope that owns them and
 * that scope's descendants. A delegated child is composed from the parent's
 * PRESET, so the parent agent's own layers never enter the child's chain: the
 * child is bounded by its preset `toolFilter` alone, and an expert can
 * therefore hold — and call — a tool the subrole never granted the chat. This
 * check is the ceiling the whole conversation shares: the subrole's reach,
 * visible tools plus the grantable ones, so a skill may still hand a tool to a
 * delegated assistant, but nothing may exceed what the role could ever grant.
 * @param ceiling - names reachable anywhere in this conversation.
 * @param toolName - the tool the model is trying to call.
 * @returns the denial reason, or `undefined` when the call is within reach.
 */
export function qaCeilingDenial(
  ceiling: ReadonlySet<string>,
  toolName: string,
): string | undefined {
  return ceiling.has(toolName) ? undefined : CEILING_DENIAL;
}
