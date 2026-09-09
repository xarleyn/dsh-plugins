/**
 * The input guard on `agent/pre-step` (design SPEC §9, §34).
 *
 * Authoritative gate for user prompts. A policy `block` rejects the step via
 * the DSH-native pre-step reject so the main-model request never starts; the
 * blocked prompt is never forwarded to the model. Warn/review continue with
 * the audit trail already recorded by the pipeline.
 *
 * Structural listener types keep this module testable without the DSH
 * runtime; the host entry adapts the real `agent/pre-step` contract.
 */

import type { ResolvedSafetyGateConfig } from "../config.js";
import type { CheckPipeline } from "../pipeline.js";
import { applyGateMode } from "../rules/policy.js";
import type { TurnRiskTracker } from "./risk-state.js";
import type { SafetyDecision } from "../types.js";

/** Structural subset of a DSH user message content block. */
export interface GuardContentBlock {
  readonly type: string;
  readonly text?: string;
}

/** Structural subset of the `agent/pre-step` payload. */
export interface PreStepPayload {
  readonly messages: ReadonlyArray<{ readonly content: ReadonlyArray<GuardContentBlock> }>;
  readonly turn: number;
  readonly step: number;
  readonly sessionId?: string;
}

export type PreStepDecisionStruct =
  | { readonly kind: "reject" }
  | { readonly kind: "enter"; readonly messages: unknown };

export type PreStepListener = (
  payload: PreStepPayload,
  next: () => Promise<PreStepDecisionStruct>,
) => Promise<PreStepDecisionStruct>;

/** Extract the scannable text from pre-step messages. */
export function extractMessagesText(payload: PreStepPayload): string {
  const parts: string[] = [];
  for (const message of payload.messages) {
    for (const block of message.content) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n");
}

export interface InputGuardResult {
  readonly decision: SafetyDecision;
  readonly scannedChars: number;
}

export interface InputGuardDeps {
  readonly config: ResolvedSafetyGateConfig;
  readonly pipeline: CheckPipeline;
  /** Receives `beginTurn` stamps so tool guards share the turn context. */
  readonly risk?: TurnRiskTracker;
}

/**
 * Build the pre-step listener. Behavior:
 *  - allow → `next()` untouched;
 *  - warn / review → `next()` (prompt continues; audit recorded);
 *  - block → `{ kind: "reject" }` without calling `next()`.
 */
export function createInputGuard(deps: InputGuardDeps): PreStepListener {
  return async (payload, next) => {
    if (payload.sessionId !== undefined && deps.risk !== undefined) {
      deps.risk.beginTurn(payload.sessionId, payload.turn ?? 0);
    }

    const content = extractMessagesText(payload);
    if (content.trim().length === 0) return next();

    const result = await deps.pipeline.run({
      content,
      channel: "input",
      direction: "input",
      classifierTrigger: "always",
      sessionId: payload.sessionId ?? null,
      turn: payload.turn ?? null,
      step: payload.step ?? null,
    });

    const decision = applyGateMode(
      result.decision,
      deps.config.mode,
    );

    if (decision === "block") {
      // The sanitized verdict is already published by the pipeline audit
      // sink; the reject carries no reason string on purpose (design SPEC §9).
      return { kind: "reject" };
    }
    return next();
  };
}
