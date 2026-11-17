/** A structured reviewer must finish its own verification before returning. */
export const REVIEW_DELEGATION_DENIED =
  "Independent reviewers cannot delegate or start background agents. " +
  "Inspect the sources yourself with the available read/search tools, report any " +
  "verification gap, and finish by calling structured_output in this run.";

interface ReviewToolExecution {
  readonly name: string;
}

/** Structural registry view; keeps this helper independent of the Host version. */
export interface ReviewToolRegistry<TScope = unknown> {
  get(
    name: string,
    scope?: TScope,
  ): { readonly output?: { readonly schema?: unknown } } | undefined;
  guard(
    guard: (execution: ReviewToolExecution) => string | undefined,
  ): () => void;
}

/**
 * Native delegation tools may have any deployment-owned name. Their canonical
 * output declares an activation receipt; consult the live definition on every
 * call so lazy registrations and replacements receive the same restriction.
 */
function returnsActivation(schema: unknown): boolean {
  if (schema === null || typeof schema !== "object") return false;
  const node = schema as Record<string, unknown>;
  const properties = node.properties as Record<string, unknown> | undefined;
  const kind = properties?.kind as Record<string, unknown> | undefined;
  const receipts = ["activation", "background", "continuable"];
  if (
    kind &&
    (receipts.includes(String(kind.const)) ||
      (Array.isArray(kind.enum) &&
        kind.enum.some((value) => receipts.includes(String(value)))))
  )
    return true;
  return [node.oneOf, node.anyOf, node.allOf].some(
    (branches) => Array.isArray(branches) && branches.some(returnsActivation),
  );
}

/** Install on the review child's own registry before its first prompt. */
export function guardReviewDelegation<TScope>(
  tools: ReviewToolRegistry<TScope>,
  scope: TScope,
): () => void {
  return tools.guard(({ name }) => {
    if (
      name === "domain_expert" ||
      name === "domain_delegate" ||
      name === "subagent" ||
      name === "qa_subagent" ||
      returnsActivation(tools.get(name, scope)?.output?.schema)
    )
      return REVIEW_DELEGATION_DENIED;
    return undefined;
  });
}
