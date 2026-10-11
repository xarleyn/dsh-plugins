import type { Context } from "@deepseek-ai/cordis";
import { scopeOf, type ScopeKey } from "@deepseek-ai/dsh-scope";

/** Resolve the context's native scope, with Agent identity as a legacy fallback. */
export function qaAgentScope(agent: unknown): ScopeKey | undefined {
  if (typeof agent !== "object" || agent === null) return undefined;
  const ctx = (agent as { ctx?: Context }).ctx;
  return ctx === undefined ? agent : (scopeOf(ctx) ?? agent);
}
