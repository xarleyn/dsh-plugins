/**
 * The tool-call gate on `tools/pre-execute` (design SPEC §17).
 *
 * Tool calls arrive fully assembled here — partial JSON never reaches the
 * classifier. Decisions reuse the native DSH permission mechanism:
 * `allow` → next(), `ask`/`review` → `{ kind: "ask" }` (native approval
 * popup), `block` → `{ kind: "deny", reason }`. High turn risk escalates the
 * surface decision by one band (SPEC §18).
 *
 * An escalation the session's approval policy would answer with a refusal
 * before asking anyone is refused here instead, with the gate's own reason:
 * the runtime's sentence for that outcome names a human who was never asked
 * (see `./approval-seam.js`).
 */

import { isGateOff, type ResolvedSafetyGateConfig } from "../config.js";
import type { CheckPipeline } from "../pipeline.js";
import { applyGateMode } from "../rules/policy.js";
import { askIsAutoRejected, type ApprovalFace } from "./approval-seam.js";
import type { TurnRiskTracker } from "./risk-state.js";
import type { SafetyDecision } from "../types.js";

/** Structural subset of the `tools/pre-execute` execution record. */
export interface GuardToolExecution {
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: {
    readonly id: string | { toString(): string };
    /** The agent's session: the approval policy is read from it. */
    readonly session?: unknown;
  };
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
    return String(Object.prototype.toString.call(args)).slice(
      0,
      MAX_ARGS_CHARS,
    );
  }
}

export interface PreExecuteGuardDeps {
  readonly config: ResolvedSafetyGateConfig;
  readonly pipeline: CheckPipeline;
  readonly risk: TurnRiskTracker;
  /**
   * The host's approval seam, read per call so a service mounted after this
   * guard is found and one unmounted mid-session simply disappears. Absent
   * when the deployment composes no approval service.
   */
  readonly approval?: () => ApprovalFace | undefined;
}

/**
 * The reason an escalation carries when it is handed to the approval seam.
 * Under a policy that cannot reach a human the same text becomes the refusal,
 * so the model learns the rule either way.
 */
function escalationReason(categories: string): string {
  return `Safety gate requests approval (${categories})`;
}

export function createPreExecuteGuard(
  deps: PreExecuteGuardDeps,
): PreExecuteListener {
  return async (exec, next) => {
    if (isGateOff(deps.config) || !deps.config.tools.enabled) return next();

    const sessionId = exec.agent !== undefined ? String(exec.agent.id) : null;
    const sensitiveOnly = deps.config.tools.sensitiveTools;
    if (sensitiveOnly.length > 0 && !sensitiveOnly.includes(exec.name))
      return next();

    const content = `${exec.name}\n${serializeToolArguments(exec.arguments)}`;
    const result = await deps.pipeline.run({
      allowQuotedDowngrade: false,
      content,
      channel: "tool",
      direction: "tools",
      classifierTrigger: deps.config.tools.semanticClassifier
        ? "always"
        : "never",
      toolName: exec.name,
      sessionId,
      turn: null,
      step: null,
    });

    // Audit mode still runs the full pipeline so findings are recorded, but
    // no finding or accumulated turn risk may affect tool execution.
    if (deps.config.mode === "audit") return next();

    const decision: SafetyDecision = applyGateMode(
      result.decision,
      deps.config.mode,
    );
    const riskLevel =
      sessionId !== null ? deps.risk.get(sessionId)?.riskLevel : undefined;
    const surface = deps.risk.escalate(decision, riskLevel);
    const categories = result.verdict.categories.join(", ") || "policy";

    if (surface === "deny") {
      // Deny without echoing matched content (sanitized audit carries the
      // verdict; the model only sees the policy reason).
      return {
        kind: "deny",
        reason: `Blocked by dsh-model-safety-gate (${categories})`,
      };
    }
    if (surface === "ask") {
      // An ask is resolved by the runtime, not here, and its outcome carries no
      // reason: under a `never` policy the runtime refuses with a sentence that
      // blames the user, so the rule that fired is lost and the model is told
      // no human asked. Refuse with our own verdict when the policy is known to
      // answer that way; anything unreadable keeps the native flow.
      if (
        deps.config.tools.unanswerableAsk === "deny" &&
        askIsAutoRejected(deps.approval?.(), exec.agent?.session)
      ) {
        return {
          kind: "deny",
          reason: `Blocked by dsh-model-safety-gate (${categories}): this call needs confirmation, but the session's approval policy is "never", so the request could only ever be refused without asking anyone`,
        };
      }
      return { kind: "ask", reason: escalationReason(categories) };
    }
    return next();
  };
}
