/**
 * The tool-call gate on `tools/pre-execute` (design SPEC §17).
 *
 * Tool calls arrive fully assembled here — partial JSON never reaches the
 * classifier. Decisions reuse the native DSH permission mechanism:
 * `allow` → next(), `ask`/`review` → `{ kind: "ask" }` (native approval
 * popup), `block` → `{ kind: "deny", reason }`. High turn risk escalates the
 * surface decision by one band (SPEC §18).
 */

import type { ResolvedSafetyGateConfig } from "../config.js";
import type { CheckPipeline } from "../pipeline.js";
import { applyGateMode } from "../rules/policy.js";
import type { TurnRiskTracker } from "./risk-state.js";
import type { SafetyDecision } from "../types.js";

/** Structural subset of the `tools/pre-execute` execution record. */
export interface GuardToolExecution {
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: { readonly id: string | { toString(): string } };
}

export type PreToolDecisionStruct =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "ask"; readonly reason?: string };

export type PreExecuteListener = (
  exec: GuardToolExecution,
  next: () => Promise<PreToolDecisionStruct>,
) => Promise<PreToolDecisionStruct>;

const MAX_ARGS_CHARS = 8_000;

/** Serialize tool arguments for scanning, bounded and key-stable. */
export function serializeToolArguments(args: unknown): string {
  try {
    const json = JSON.stringify(args, null, 0);
    return json === undefined ? "" : json.slice(0, MAX_ARGS_CHARS);
  } catch {
    return String(Object.prototype.toString.call(args)).slice(0, MAX_ARGS_CHARS);
  }
}

export interface PreExecuteGuardDeps {
  readonly config: ResolvedSafetyGateConfig;
  readonly pipeline: CheckPipeline;
  readonly risk: TurnRiskTracker;
}

export function createPreExecuteGuard(deps: PreExecuteGuardDeps): PreExecuteListener {
  return async (exec, next) => {
    if (!deps.config.tools.enabled) return next();

    const sessionId = exec.agent !== undefined ? String(exec.agent.id) : null;
    const sensitiveOnly = deps.config.tools.sensitiveTools;
    if (sensitiveOnly.length > 0 && !sensitiveOnly.includes(exec.name)) return next();

    const content = `${exec.name}\n${serializeToolArguments(exec.arguments)}`;
    const result = await deps.pipeline.run({
      allowQuotedDowngrade: false,
      content,
      channel: "tool",
      direction: "tools",
      classifierTrigger: deps.config.tools.semanticClassifier ? "always" : "never",
      toolName: exec.name,
      sessionId,
      turn: null,
      step: null,
    });

    const decision: SafetyDecision = applyGateMode(result.decision, deps.config.mode);
    const riskLevel = sessionId !== null ? deps.risk.get(sessionId)?.riskLevel : undefined;
    const surface = deps.risk.escalate(decision, riskLevel);

    if (surface === "deny") {
      // Deny without echoing matched content (sanitized audit carries the
      // verdict; the model only sees the policy reason).
      return { kind: "deny", reason: `Blocked by dsh-model-safety-gate (${result.verdict.categories.join(", ") || "policy"})` };
    }
    if (surface === "ask") {
      return { kind: "ask", reason: `Safety gate requests approval (${result.verdict.categories.join(", ") || "policy"})` };
    }
    return next();
  };
}
