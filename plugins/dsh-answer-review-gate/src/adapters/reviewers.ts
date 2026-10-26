/**
 * Reviewer backends (`SPEC.md`, "Reviewer isolation", "Domain Experts
 * integration"). Both run the reviewer in a fresh context with only the
 * review material; both fail loudly instead of inventing a PASS.
 */

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

import type { ResolvedAnswerReviewGateConfig } from "../config.js";
import { expertReviewPacket } from "./review-packet.js";
import {
  assertReviewActive,
  canRecoverCapture,
  CAPTURE_RECOVERY_INSTRUCTION,
} from "../recovery.js";
import {
  REVIEWER_OUTPUT_SCHEMA,
  renderExpertReviewTask,
  renderSubagentReviewerTask,
} from "../prompt.js";
import type { QaModelPolicyPair } from "../qa-policy.js";
import { ReviewerFailure } from "../types.js";
import {
  deriveVerdictFromExpertResult,
  validateReviewerVerdict,
} from "../verdict.js";
import type {
  DomainExpertsFace,
  ReviewInput,
  ReviewerBackend,
  SubagentAgentOptions,
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
  readonly workspaceRoot?: string;
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
      const images = input.requestImages ?? [];
      if (images.length > 0 && deps.face.reviewExpert === undefined) {
        throw new ReviewerFailure(
          "expert-image-input-unavailable",
          "the installed domain-experts service cannot receive review images; update it before reviewing this request",
        );
      }
      const packet = await expertReviewPacket(
        renderExpertReviewTask(input),
        deps.workspaceRoot,
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assertReviewActive(input);
        const task =
          attempt === 0
            ? packet.task
            : `${CAPTURE_RECOVERY_INSTRUCTION}\n\n${packet.task}`;
        const outcome =
          images.length > 0
            ? await deps.face.reviewExpert!(
                deps.config.domain,
                task,
                input.sessionId,
                images,
              )
            : await deps.face.testExpert(
                deps.config.domain,
                task,
                input.sessionId,
                true,
              );
        await packet.verify();
        assertReviewActive(input);
        if (!outcome.ok || outcome.result === null) {
          throw new ReviewerFailure(
            "expert-run-failed",
            `${outcome.code}: ${outcome.message}`,
          );
        }
        if (
          canRecoverCapture(
            attempt,
            outcome.result.status,
            outcome.result.structured !== false,
            outcome.result.diagnostic,
          )
        ) {
          input.onRecovery?.();
          continue;
        }
        return deriveVerdictFromExpertResult(outcome.result);
      }
      throw new ReviewerFailure("expert-output-not-captured");
    },
  };
}

/**
 * Audit/log code for the tool boundary this Host can no longer compose.
 * The same limitation and the same code as dsh-domain-experts' degradation.
 */
const TOOL_UNFILTERABLE = "TOOL_UNFILTERABLE";

/**
 * The runtime's canonical code for a composition it refuses before an
 * activation exists (`SubagentError`, `UNSUPPORTED_CAPABILITY`).
 */
const UNSUPPORTED_CAPABILITY_CODE = "UNSUPPORTED_CAPABILITY";

/**
 * `reviewer.backend = subagent`: start a native reviewer child as a foreground
 * activation — `delivery: "caller"`, the awaited `activation.result`, then
 * `dispose()` — with this plugin's persona and route settings and the
 * structured verdict schema. The reviewer is exempt from the gate
 * structurally — it is a subagent child.
 *
 * Its model comes from this plugin's own configuration, which is what keeps the
 * reviewer independent of whoever was answered. A deployment that leaves that
 * configuration silent on the model — the reviewer following whatever chat it is
 * reviewing — is where the QA policy speaks instead: the child then runs the
 * pair the reviewed chat's role was given, not the model some visitor picked.
 *
 * On the 0.2.1 activation contract the persona travels as the first block of
 * the child's task prompt, and the tool allow-list has no request field any
 * more: the Host composes a child's tools from its Agent Preset
 * (`reviewer.agentPreset`, sent as `request.agentPreset`). A deployment that
 * names a tool list without a preset gets a reviewer under the parent's tool
 * composition, and the gate says so instead of letting the config read as
 * enforcement.
 */
export function createSubagentBackend(deps: {
  readonly face: SubagentsFace | undefined;
  readonly config: ReviewerConfig;
  readonly parent: unknown;
  readonly modelPolicy?: QaModelPolicyPair | undefined;
  /** Told once per review when a configured guarantee cannot be composed. */
  readonly onDegradation?: (code: string, detail: string) => void;
}): ReviewerBackend {
  const policy = deps.config.model === "" ? deps.modelPolicy : undefined;
  const provider =
    deps.config.route !== ""
      ? deps.config.route
      : (policy?.provider ?? "inherit");
  const model =
    deps.config.model !== "" ? deps.config.model : (policy?.model ?? "inherit");
  // `?? ""` keeps a config that did not pass the resolver honest too: an
  // absent preset means "no preset", never "an unresolvable empty id".
  const preset = deps.config.agentPreset ?? "";
  let boundaryReported = false;
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
      const effort =
        deps.config.reasoningEffort !== ""
          ? deps.config.reasoningEffort
          : (policy?.reasoningEffort ?? "");
      const agentOptions: SubagentAgentOptions = {
        ...(provider !== "inherit" ? { provider } : {}),
        ...(model !== "inherit" ? { model } : {}),
        ...(effort !== "" ? { reasoningEffort: effort } : {}),
      };

      // Preflight the provider's capability advertisement so a composition
      // this backend cannot honor is refused with this plugin's reason rather
      // than as a raw runtime rejection — and so an inheriting reviewer is not
      // charged for an override it never asked for.
      const backend = deps.face.getProvider(deps.config.provider);
      if (backend === undefined) {
        throw new ReviewerFailure(
          "reviewer-provider-missing",
          `subagent provider "${deps.config.provider}" is not registered`,
        );
      }
      if (backend.capabilities.outputSchema !== true) {
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          `subagent provider "${backend.name}" cannot capture structured output; the review verdict needs it`,
        );
      }
      if (
        Object.keys(agentOptions).length > 0 &&
        backend.capabilities.agentOptions !== true
      ) {
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          `subagent provider "${backend.name}" cannot apply the reviewer's provider/model overrides`,
        );
      }
      if (preset !== "" && backend.capabilities.agentPreset !== true) {
        throw new ReviewerFailure(
          "reviewer-capability-unsupported",
          `subagent provider "${backend.name}" cannot select an agent preset for the reviewer`,
        );
      }

      // The start request accepts no per-run tool scoping any more, so the
      // configured allow-list composes nothing here. Say so once per review
      // instead of letting the configuration read as enforcement.
      if (!boundaryReported) {
        boundaryReported = true;
        deps.onDegradation?.(
          TOOL_UNFILTERABLE,
          "the reviewer's tool allow-list cannot be scoped per run on this Host: " +
            "the child starts under the parent's tool composition. " +
            "Express the boundary in an Agent Preset selected by reviewer.agentPreset.",
        );
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        assertReviewActive(input);
        const prompt: ContentBlock[] = [
          // The activation contract carries no per-child persona: the
          // configured instruction leads the child's first message, so it
          // still frames everything the candidate says after it.
          ...(deps.config.persona === ""
            ? []
            : [
                {
                  type: "text",
                  text: deps.config.persona,
                } satisfies ContentBlock,
              ]),
          {
            type: "text",
            text:
              (attempt === 0 ? "" : `${CAPTURE_RECOVERY_INSTRUCTION}\n\n`) +
              renderSubagentReviewerTask({
                ...(input.conversationContext === undefined
                  ? {}
                  : { conversationContext: input.conversationContext }),
                ...(input.primaryTools === undefined
                  ? {}
                  : { primaryTools: input.primaryTools }),
                requestText: input.requestText,
                requestAttachments: input.requestAttachments,
                candidateText: input.candidateText,
              }),
          },
          ...(input.requestImages ?? []),
        ];
        let activation;
        try {
          activation = await deps.face.startActivation({
            provider: deps.config.provider,
            label: "answer-review",
            request: {
              prompt,
              parent: deps.parent,
              ...(preset === "" ? {} : { agentPreset: preset }),
              ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
              outputSchema: REVIEWER_OUTPUT_SCHEMA,
            },
            signal: input.signal,
            // A foreground reviewer: the parent model must not be notified,
            // the result belongs to this review alone.
            delivery: "caller",
          });
        } catch (error) {
          // The runtime refuses an unsupported composition before an
          // activation exists; an unknown tool or option names surface here too.
          if (
            (error as { code?: unknown }).code === UNSUPPORTED_CAPABILITY_CODE
          ) {
            throw new ReviewerFailure(
              "reviewer-capability-unsupported",
              error instanceof Error ? error.message : String(error),
            );
          }
          throw new ReviewerFailure(
            "reviewer-start-failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        try {
          let result;
          try {
            result = await activation.result;
          } catch (error) {
            // The contract rejects the result only when the Host could not
            // capture one at all — a reviewer infrastructure failure.
            throw new ReviewerFailure(
              "reviewer-result-unavailable",
              error instanceof Error ? error.message : String(error),
            );
          }
          assertReviewActive(input);
          if (
            canRecoverCapture(
              attempt,
              result.stopReason,
              result.structured !== undefined,
              result.diagnostic,
            )
          ) {
            input.onRecovery?.();
            continue;
          }
          if (result.stopReason !== "completed") {
            throw new ReviewerFailure(
              `reviewer-${result.stopReason}`,
              result.diagnostic ?? "",
            );
          }
          if (result.structured !== undefined) {
            return validateReviewerVerdict(result.structured);
          }
          throw new ReviewerFailure("reviewer-output-not-captured");
        } finally {
          // Await the child teardown: `dispose()` is asynchronous on the host
          // (the domain-experts runner awaits it too), so a fire-and-forget call
          // left the child fiber running past the review. Disposal is
          // best-effort — it must never mask the review outcome.
          try {
            await activation.dispose();
          } catch {
            /* disposal failure must not override the verdict or the failure */
          }
        }
      }
      throw new ReviewerFailure("reviewer-output-not-captured");
    },
  };
}
