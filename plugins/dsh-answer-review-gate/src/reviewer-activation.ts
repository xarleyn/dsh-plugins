import { randomUUID } from "node:crypto";
import {
  guardReviewDelegation,
  type ReviewToolRegistry,
} from "@yadsh/dsh-plugin-kit";
import type { GateHostContext } from "./index.js";
import { ReviewerFailure, type SubagentsFace } from "./types.js";

/** Reserve a local reviewer and install its guard before the first prompt. */
export function nonDelegatingReviewers(
  ctx: GateHostContext,
  face: SubagentsFace,
): SubagentsFace {
  return {
    getProvider: (name) => face.getProvider(name),
    async startActivation(spec) {
      if (face.getProvider(spec.provider)?.prepareContinuable === undefined)
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          "independent reviewers require a local managed provider to enforce their delegation policy",
        );
      const childId = randomUUID();
      let applied = false;
      const unsubscribe = ctx.on(
        "agent/created",
        ({
          agent,
        }: {
          agent: {
            readonly id: string;
            readonly ctx: { readonly tools: ReviewToolRegistry };
          };
        }) => {
          if (String(agent.id) !== childId) return;
          guardReviewDelegation(agent.ctx.tools, agent);
          applied = true;
        },
        { global: true },
      );
      try {
        const activation = await face.startActivation({ ...spec, childId });
        if (!applied || String(activation.childId) !== childId) {
          await activation.dispose();
          throw new ReviewerFailure(
            "reviewer-capability-unsupported",
            "the provider did not apply the reserved review child's delegation policy",
          );
        }
        return activation;
      } finally {
        unsubscribe();
      }
    },
  };
}
