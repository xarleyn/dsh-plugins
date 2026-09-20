/**
 * Reviewer backends (`SPEC.md`, "Reviewer isolation", "Domain Experts
 * integration"). Both run the reviewer in a fresh context with only the
 * review material; both fail loudly instead of inventing a PASS.
 */

import type { ResolvedAnswerReviewGateConfig } from "../config.js";
import { textOfBlocks } from "../candidate.js";
import {
  REVIEWER_OUTPUT_SCHEMA,
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../prompt.js";
import { ReviewerFailure } from "../types.js";
import {
  deriveVerdictFromExpertResult,
  parseReviewerVerdict,
  validateReviewerVerdict,
} from "../verdict.js";
import type {
  DomainExpertsFace,
  ReviewInput,
  ReviewerBackend,
  SubagentsFace,
} from "../types.js";

/** The reviewer sub-config the backends consume. */
export type ReviewerConfig = ResolvedAnswerReviewGateConfig["reviewer"];

/**
 * `reviewer.backend = domain-expert`: run the configured reviewer domain of
 * dsh-domain-experts by stable domain id. The face is the caller's per-call
 * `ctx.get("domainExperts")` result; absence is a reviewer failure handled
 * by the failure policy, never a load-time dependency.
 *
 * Known Phase 1 bound: the domain-experts test entry owns its lifecycle, so
 * the run is not bound to the gate's abort signal (bounded single run).
 */
export function createDomainExpertBackend(deps: {
  readonly face: DomainExpertsFace | undefined;
  readonly config: ReviewerConfig;
}): ReviewerBackend {
  return {
    name: "domain-expert",
    reviewer: deps.config.domain,
    async review(input: ReviewInput) {
      if (deps.face === undefined) {
        throw new ReviewerFailure(
          "domain-experts-unavailable",
          "the dsh-domain-experts service is not loaded",
        );
      }
      if (deps.config.domain === "") {
        throw new ReviewerFailure(
          "reviewer-domain-not-configured",
          "reviewer.domain is empty",
        );
      }
      const outcome = await deps.face.testExpert(
        deps.config.domain,
        renderExpertReviewTask(input),
        input.sessionId,
      );
      if (!outcome.ok || outcome.result === null) {
        throw new ReviewerFailure(
          "expert-run-failed",
          `${outcome.code}: ${outcome.message}`,
        );
      }
      return deriveVerdictFromExpertResult(outcome.result);
    },
  };
}

/**
 * `reviewer.backend = subagent`: start a native reviewer child with this
 * plugin's persona/route settings, a read-only tool allow-list and the
 * structured verdict schema. The reviewer is exempt from the gate
 * structurally — it is a subagent child.
 */
export function createSubagentBackend(deps: {
  readonly face: SubagentsFace | undefined;
  readonly config: ReviewerConfig;
  readonly parent: unknown;
}): ReviewerBackend {
  return {
    name: "subagent",
    reviewer: reviewerRouteLabel(deps.config),
    async review(input: ReviewInput) {
      if (deps.face === undefined) {
        throw new ReviewerFailure(
          "subagents-unavailable",
          "the subagents service is not loaded",
        );
      }
      const agentOptions: {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
      } = {};
      if (deps.config.route !== "") agentOptions.provider = deps.config.route;
      if (deps.config.model !== "") agentOptions.model = deps.config.model;
      if (deps.config.reasoningEffort !== "") {
        agentOptions.reasoningEffort = deps.config.reasoningEffort;
      }
      let run;
      try {
        run = await deps.face.start(deps.config.provider, {
          label: "answer-review",
          prompt: [
            {
              type: "text",
              text: renderSubagentReviewerTask({
                requestText: input.requestText,
                candidateText: input.candidateText,
              }),
            },
          ],
          parent: deps.parent,
          signal: input.signal,
          ...(deps.config.persona === ""
            ? {}
            : { persona: deps.config.persona }),
          ...(deps.config.allowedTools.length > 0
            ? { toolFilter: { allow: deps.config.allowedTools } }
            : {}),
          ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
          outputSchema: REVIEWER_OUTPUT_SCHEMA,
        });
      } catch (error) {
        // Unknown tool-filter names and unsupported composition surface here.
        throw new ReviewerFailure(
          "reviewer-start-failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      try {
        const result = await run.result;
        if (result.stopReason !== "completed") {
          throw new ReviewerFailure(
            `reviewer-${result.stopReason}`,
            result.diagnostic ?? "",
          );
        }
        if (result.structured !== undefined) {
          return validateReviewerVerdict(result.structured);
        }
        return parseReviewerVerdict(textOfBlocks(result.output));
      } finally {
        run.dispose();
      }
    },
  };
}

function reviewerRouteLabel(config: ReviewerConfig): string {
  const route = config.route !== "" ? config.route : "inherit";
  const model = config.model !== "" ? config.model : "inherit";
  return `${config.provider}/${route}/${model}`;
}
