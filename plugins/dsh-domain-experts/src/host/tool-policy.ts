import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import type {
  SubagentActivation,
  SubagentActivationSpec,
} from "@deepseek-ai/dsh-subagent";
import type { SubagentsFace } from "./execution.js";
import { DomainExpertsError, unsupportedCapability } from "./errors.js";

export interface ExpertToolFilter {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/** Apply a local child's restriction before its first prompt can be submitted. */
export async function startRestrictedExpert(
  ctx: Context,
  subagents: SubagentsFace,
  spec: SubagentActivationSpec,
  filter?: ExpertToolFilter,
): Promise<SubagentActivation> {
  if (filter === undefined) return subagents.startActivation(spec);
  // Only a local managed provider accepts a reserved child identity. A remote
  // backend cannot be constrained through this process's agent context.
  if (subagents.getProvider(spec.provider)?.prepareContinuable === undefined) {
    throw unsupportedCapability(
      spec.provider,
      "tool policy",
      "the expert needs a local managed child with a scoped tool registry",
    );
  }
  const childId = SessionId(randomUUID());
  let applied = false;
  const unsubscribe = ctx.on("agent/created", ({ agent }) => {
    if (agent.id !== childId) return;
    try {
      // The Host composes the preset before this serial lifecycle event and
      // submits the initial prompt only after it. The restriction belongs to
      // the child's context, so its teardown and concurrent siblings remain
      // the Host's responsibility. Unknown names refuse the creation.
      agent.ctx.tools.restrict({
        allow: [...filter.allow],
        ...(filter.deny.length === 0 ? {} : { deny: [...filter.deny] }),
      });
      applied = true;
    } catch (cause) {
      throw new DomainExpertsError(
        "WORKER_UNAVAILABLE",
        `The expert's tool policy could not be applied: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  });
  try {
    const activation = await subagents.startActivation({ ...spec, childId });
    if (!applied || activation.childId !== childId) {
      await activation.dispose();
      throw unsupportedCapability(
        spec.provider,
        "tool policy",
        "the provider did not create the reserved child under the scoped restriction",
      );
    }
    return activation;
  } finally {
    unsubscribe();
  }
}
