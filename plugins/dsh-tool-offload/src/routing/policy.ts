/**
 * RoutingPolicy (SPEC §9.2, §10, §31).
 *
 * Pure and deterministic — no service lookups, no LLM. Machine-readable
 * passthrough reasons double as telemetry dimensions. Availability of the
 * worker provider is checked later by the runner so this policy stays total.
 */

import type { ResolvedToolOffloadConfig } from "../config.js";
import type { OffloadCandidate } from "./inspect-result.js";
import { matchesAnyTool } from "./matcher.js";

export type OffloadSkipReason =
  | "tool-error"
  | "tool-denied"
  | "tool-not-allowed"
  | "non-text-result"
  | "below-threshold"
  | "payload-too-large"
  | "rule-passthrough";

export type RouteDecision =
  | { readonly kind: "passthrough"; readonly reason: OffloadSkipReason }
  | { readonly kind: "offload"; readonly worker: string; readonly prompt: string };

/**
 * Deterministic routing (SPEC §31): eligibility first (deny/allow, textual,
 * thresholds, payload bound), then the first matching rule selects the
 * worker/prompt profile or forces passthrough; the implicit final rule is
 * the default worker with the `generic` prompt.
 */
export function decideRoute(candidate: OffloadCandidate, config: ResolvedToolOffloadConfig): RouteDecision {
  const { toolName } = candidate;

  // Error results stay verbatim evidence for the parent (SPEC §10.4).
  if (candidate.resultKind !== "success") return { kind: "passthrough", reason: "tool-error" };
  if (matchesAnyTool(config.routing.deny, toolName)) return { kind: "passthrough", reason: "tool-denied" };
  if (config.routing.mode === "allowlist" && !matchesAnyTool(config.routing.allow, toolName)) {
    return { kind: "passthrough", reason: "tool-not-allowed" };
  }
  if (!candidate.isTextual) return { kind: "passthrough", reason: "non-text-result" };

  const largeEnough =
    candidate.byteLength >= config.routing.thresholds.minBytes ||
    candidate.estimatedTokens >= config.routing.thresholds.minEstimatedTokens;
  if (!largeEnough) return { kind: "passthrough", reason: "below-threshold" };

  if (candidate.byteLength > config.payload.maxBytes) return { kind: "passthrough", reason: "payload-too-large" };

  for (const rule of config.routing.rules) {
    if (rule.tools.length > 0 && !matchesAnyTool(rule.tools, toolName)) continue;
    if (rule.minBytes !== null && candidate.byteLength < rule.minBytes) continue;
    if (rule.action === "passthrough") return { kind: "passthrough", reason: "rule-passthrough" };
    return { kind: "offload", worker: rule.worker, prompt: rule.prompt };
  }
  return { kind: "offload", worker: config.defaultWorker, prompt: "generic" };
}
