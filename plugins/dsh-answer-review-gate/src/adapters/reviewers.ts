/**
 * Reviewer backends (`SPEC.md`, "Reviewer isolation", "Domain Experts
 * integration"). Both run the reviewer in a fresh context with only the
 * review material; both fail loudly instead of inventing a PASS.
 */

import type { ResolvedAnswerReviewGateConfig } from "../config.js";
import { textOfBlocks } from "../candidate.js";
import { restrictReviewerTools } from "../reviewer-tools.js";
import {
  REVIEWER_OUTPUT_SCHEMA,
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../prompt.js";
import type { QaModelPolicyPair } from "../qa-policy.js";
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
 * Lifecycle bound: the domain-experts `testExpert` entry owns its run and its
 * face exposes no abort-signal parameter, so a started review cannot be
 * cancelled from here. The most the gate can honour is the signal's state at
 * the boundary: a turn already aborted at entry does not launch a doomed
 * reviewer run.
 */
export function createDomainExpertBackend(deps: {
  readonly face: DomainExpertsFace | undefined;
  readonly config: ReviewerConfig;
}): ReviewerBackend {
  return {
    name: "domain-expert",
    reviewer: deps.config.domain,
    async review(input: ReviewInput) {
      if (input.signal.aborted) {
        throw new ReviewerFailure(
          "reviewer-aborted",
          "the reviewed turn was cancelled before the reviewer started",
        );
      }
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
 *
 * Its model comes from this plugin's own configuration, which is what keeps the
 * reviewer independent of whoever was answered. A deployment that leaves that
 * configuration silent on the model — the reviewer following whatever chat it is
 * reviewing — is where the QA policy speaks instead: the child then runs the
 * pair the reviewed chat's role was given, not the model some visitor picked.
 */
export function createSubagentBackend(deps: {
  readonly face: SubagentsFace | undefined;
  readonly config: ReviewerConfig;
  readonly parent: unknown;
  readonly modelPolicy?: QaModelPolicyPair | undefined;
}): ReviewerBackend {
  const policy = deps.config.model === "" ? deps.modelPolicy : undefined;
  const provider =
    deps.config.route !== ""
      ? deps.config.route
      : (policy?.provider ?? "inherit");
  const model =
    deps.config.model !== "" ? deps.config.model : (policy?.model ?? "inherit");
  return {
    name: "subagent",
    reviewer: `${deps.config.provider}/${provider}/${model}`,
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
      if (provider !== "inherit") agentOptions.provider = provider;
      if (model !== "inherit") agentOptions.model = model;
      const effort =
        deps.config.reasoningEffort !== ""
          ? deps.config.reasoningEffort
          : (policy?.reasoningEffort ?? "");
      if (effort !== "") agentOptions.reasoningEffort = effort;
      let run;
      try {
        run = await deps.face.start(deps.config.provider, {
          label: "answer-review",
          prompt: [
            {
              type: "text",
              text: renderSubagentReviewerTask({
                requestText: input.requestText,
                requestAttachments: input.requestAttachments,
                candidateText: input.candidateText,
              }),
            },
          ],
          parent: deps.parent,
          signal: input.signal,
          ...(deps.config.persona === ""
            ? {}
            : { persona: deps.config.persona }),
          // Always send the allow-list, empty included: the host only calls
          // `tools.restrict()` when a `toolFilter` is present, so omitting it
          // for an empty list handed the reviewer the parent's whole tool
          // surface — the opposite of the config's "empty means no tools".
          // Re-read through the boundary here rather than trusting the resolved
          // config: this is the call that composes the child, and a reviewer
          // that could delete a workspace file parked the parent turn for an
          // approval a delegated child can never receive.
          toolFilter: {
            allow: restrictReviewerTools(deps.config.allowedTools),
          },
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
        // Await the child teardown: `dispose()` is asynchronous on the host
        // (the domain-experts runner awaits it too), so a fire-and-forget call
        // left the child fiber running past the review. Disposal is
        // best-effort — it must never mask the review outcome.
        try {
          await run.dispose();
        } catch {
          /* disposal failure must not override the verdict or the failure */
        }
      }
    },
  };
}
