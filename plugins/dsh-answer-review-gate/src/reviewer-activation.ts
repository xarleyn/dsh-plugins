import { randomUUID } from "node:crypto";
import * as reviewKit from "@yadsh/dsh-plugin-kit/review-foreground";
import type { GateHostContext } from "./index.js";
import { ReviewerFailure, type SubagentsFace } from "./types.js";

/** Reserve a local reviewer and await its delegations from the first prompt. */
export function foregroundReviewers(
  ctx: GateHostContext,
  face: SubagentsFace,
  allowedTools?: readonly string[],
): SubagentsFace {
  return {
    enforcesReviewToolPolicy: allowedTools !== undefined,
    getProvider: (name) => face.getProvider(name),
    async startActivation(spec) {
      if (face.getProvider(spec.provider)?.prepareContinuable === undefined)
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          "independent reviewers require a local managed provider to await delegated work",
        );
      if (
        allowedTools &&
        typeof reviewKit.installReviewToolPolicy !== "function"
      )
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          "the installed plugin kit cannot enforce the reviewer's tool policy",
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
            readonly ctx: reviewKit.ForegroundReviewContext;
          };
        }) => {
          if (String(agent.id) !== childId) return;
          if (allowedTools)
            reviewKit.installReviewToolPolicy(agent.ctx, agent, allowedTools);
          reviewKit.installForegroundReview(agent.ctx, agent);
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
            "the provider did not apply the reserved review child's foreground policy",
          );
        }
        return activation;
      } finally {
        unsubscribe();
      }
    },
  };
}
