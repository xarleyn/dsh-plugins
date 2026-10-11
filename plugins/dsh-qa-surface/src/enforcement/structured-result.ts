import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import { scopeChainOf } from "@deepseek-ai/dsh-scope";
import { qaAgentScope } from "../agent-scope.js";

/**
 * Native delegation's result channel is not a working capability. Admit only
 * the exact child-owned capture registration, never a global/inherited tool
 * with the same name. Registrations and session lineage are Host-owned; model
 * arguments cannot create either. Schema validation and authoritative capture
 * remain the native driver's responsibility.
 */
export function isDelegatedStructuredResult(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
): boolean {
  if (name !== "structured_output" || agent === undefined) return false;
  const header = agent.session.header;
  if (
    header.origin !== "subagent" ||
    header.parentSession === undefined ||
    (header.delegationDepth ?? 0) < 1
  )
    return false;
  const scope = qaAgentScope(agent);
  if (scope === undefined) return false;
  const definition = ctx.tools.get(name, scope);
  if (definition === undefined || definition === ctx.tools.get(name))
    return false;
  if (
    scopeChainOf(scope)
      .slice(1)
      .some((parent) => ctx.tools.get(name, parent) === definition)
  )
    return false;
  const output = definition.output?.schema;
  return (
    definition.parameters.type === "object" &&
    output?.type === "object" &&
    output.additionalProperties === false &&
    output.required?.length === 1 &&
    output.required[0] === "recorded" &&
    Object.keys(output.properties ?? {}).length === 1 &&
    output.properties?.recorded?.type === "boolean" &&
    output.properties.recorded.const === true
  );
}
