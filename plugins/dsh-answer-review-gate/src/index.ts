/**
 * dsh-answer-review-gate — mandatory independent answer review gate for
 * DeepSeek Harness agents.
 *
 * At every `agent/turn-stopping` boundary the plugin runs an independent
 * reviewer over the candidate final answer and, on a REVISE verdict, steers
 * the findings back into the primary agent so the turn continues with a
 * corrected candidate (`SPEC.md`). Interim orchestration turns — turns that
 * close while the session's own background delegations are still pending —
 * are never reviewed: the decision is pure runtime state, never text
 * heuristics.
 *
 * The plugin owns no tools and no client surface: it is a lifecycle
 * requirement, not a prompt suggestion.
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { getPluginLogger } from "@yadsh/dsh-plugin-log";

import { ReviewAudit } from "./audit.js";
import {
  AnswerReviewGateConfigSchema,
  resolveAnswerReviewGateConfig,
  type AnswerReviewGateConfig,
  type ResolvedAnswerReviewGateConfig,
} from "./config.js";
import { AnswerReviewGate, type GateAgent, type GateLogSink } from "./gate.js";
import { DELEGATION_TOOL_NAME } from "./delegation-tracker.js";
import type { DomainExpertsFace, SubagentsFace } from "./types.js";

export {
  AnswerReviewGateConfigSchema,
  resolveAnswerReviewGateConfig,
  ANSWER_REVIEW_GATE_DEFAULTS,
} from "./config.js";
export type {
  AnswerReviewGateConfig,
  ResolvedAnswerReviewGateConfig,
} from "./config.js";
export {
  AnswerReviewGate,
  type GateAgent,
  type GateLogSink,
  type AnswerReviewGateDeps,
} from "./gate.js";
export {
  DelegationTracker,
  DELEGATION_TOOL_NAME,
} from "./delegation-tracker.js";
export { ReviewAudit } from "./audit.js";
export { ReviewerFailure } from "./types.js";
export type {
  DomainExpertsFace,
  ExpertRunOutcome,
  ExpertRunResult,
  PendingDelegation,
  ReviewAuditEntry,
  ReviewCategory,
  ReviewInput,
  ReviewIssue,
  ReviewSeverity,
  ReviewVerdict,
  SubagentsFace,
  SubagentStartSpec,
  SubagentRunHandle,
  SubagentRunResult,
} from "./types.js";

/** Runtime plugin id. */
export const name = "dsh-answer-review-gate";

/** Schemastery configuration contract (Cordis fills it before `apply`). */
export const Config = AnswerReviewGateConfigSchema;

/**
 * Structural view of the host surface the plugin subscribes through.
 * Listeners registered through the plugin's own context live on the plugin
 * fiber and are disposed with it — that is the cleanup path.
 */
export interface GateHostContext {
  on(
    event: string,
    handler: unknown,
    options?: { readonly global?: boolean },
  ): () => void;
  /** Per-call soft service resolution (strict `get`, undefined until ACTIVE). */
  get(service: string): unknown;
}

/**
 * Plugin entry: resolve config and subscribe the lifecycle seams
 * (`agent/turn-stopping`, `tools/result`, `agent/inbox/inserted`,
 * `agent/disposed`). The reviewer backend services are read per call, so the
 * gate loads even when its backend plugin is absent — the failure policy
 * then handles the reviewer failures honestly.
 */
export function apply(
  ctx: GateHostContext,
  rawConfig?: AnswerReviewGateConfig,
): void {
  const configSource = (): ResolvedAnswerReviewGateConfig =>
    resolveAnswerReviewGateConfig(rawConfig);
  const logger = getPluginLogger({ pluginId: name });
  const config = configSource();
  if (!config.enabled) {
    logger.info("plugin.disabled");
    return;
  }

  const audit = new ReviewAudit(config.audit.maxEntries);
  const gate = new AnswerReviewGate({
    config: configSource,
    logger: logger as GateLogSink,
    audit,
    now: () => Date.now(),
    // The provider registers this service as `ctx.domainExperts` (its own
    // wiring test pins the key): `domain-experts` is the plugin id and the
    // settings namespace, not the service name, and asking for it resolved to
    // nothing — every review then failed as "service is not loaded" while the
    // plugin was running right next to this one.
    domainExperts: () =>
      ctx.get("domainExperts") as DomainExpertsFace | undefined,
    subagents: () => ctx.get("subagents") as SubagentsFace | undefined,
    steerMessage: (agent, text, summary) => {
      agent.steer(
        createUserMessage({
          content: [{ type: "text", text }],
          source: { kind: "plugin", plugin: name, form: "notice", summary },
        }),
      );
    },
  });

  ctx.on(
    "agent/turn-stopping",
    (async (payload: {
      agent?: GateAgent;
      turn: number;
      signal: AbortSignal;
    }) => {
      if (payload.agent === undefined) return;
      await gate.handleTurnStopping(
        payload.agent,
        payload.turn,
        payload.signal,
      );
    }) as never,
    { global: true },
  );

  ctx.on(
    "tools/result",
    ((
      exec: {
        readonly name: string;
        readonly agent?: { readonly id: unknown };
      },
      result: unknown,
    ) => {
      if (exec.name !== DELEGATION_TOOL_NAME || exec.agent === undefined)
        return;
      gate.delegation.observeToolResult(
        {
          name: exec.name,
          agent: { id: String(exec.agent.id) },
        },
        result as { readonly isError: boolean; readonly value?: unknown },
        gate.lastSeenTurnOf(String(exec.agent.id)),
      );
    }) as never,
    { global: true },
  );

  ctx.on(
    "agent/inbox/inserted",
    ((payload: {
      agent?: { readonly id: unknown };
      message?: { readonly source?: unknown };
    }) => {
      if (payload.agent === undefined || payload.message === undefined) return;
      gate.delegation.observeInboxInsert(
        String(payload.agent.id),
        payload.message,
      );
    }) as never,
    { global: true },
  );

  ctx.on(
    "agent/disposed",
    ((payload: { agent?: { readonly id: unknown } }) => {
      if (payload.agent === undefined) return;
      gate.forgetAgent(String(payload.agent.id));
    }) as never,
    { global: true },
  );

  logger.info("plugin.applied", {
    backend: config.reviewer.backend,
    reviewer:
      config.reviewer.backend === "domain-expert"
        ? config.reviewer.domain
        : config.reviewer.provider,
    failMode: config.failMode,
    maxReviewRounds: config.maxReviewRounds,
    trackBackgroundDelegations: config.trackBackgroundDelegations,
  });
}
