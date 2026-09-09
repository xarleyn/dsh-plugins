/**
 * Verdict and policy merging (design SPEC §4, §19).
 *
 * The safety model is monotonic: a deterministic L0 red line can never be
 * weakened by the L1 classifier, and merged decisions only escalate
 * (`allow < warn < review < block`). Safety and usefulness stay independent
 * dimensions — usefulness never blocks unless the operator opts in.
 */

import type {
  CheckDirection,
  ContentChannel,
  SafetyCategory,
  SafetyDecision,
  SafetyVerdict,
  ScanResult,
} from "../types.js";
import { DECISION_ORDER, VERDICT_VERSION } from "../types.js";
import type { GateMode, ResolvedSafetyGateConfig } from "../config.js";

/** Monotonic max over decisions (SPEC §19: BLOCK → ALLOW is impossible). */
export function mergeDecisions(...decisions: readonly SafetyDecision[]): SafetyDecision {
  let merged: SafetyDecision = "allow";
  for (const decision of decisions) {
    if (DECISION_ORDER[decision] > DECISION_ORDER[merged]) merged = decision;
  }
  return merged;
}

/** Cap a decision for non-enforcing modes (SPEC §24). */
export function applyGateMode(decision: SafetyDecision, mode: GateMode): SafetyDecision {
  if (mode === "audit") return "allow";
  if (mode === "warn" && decision === "block") return "warn";
  return decision;
}

const emptyVerdict = (decision: SafetyDecision): SafetyVerdict => ({
  version: VERDICT_VERSION,
  decision,
  confidence: 1,
  categories: [],
  summary: "",
});

/**
 * Merge an L0 scan with an optional L1 verdict. `l1 === null` means the
 * classifier layer did not run (disabled or failure handled elsewhere);
 * `l1Failure` records the failure decision from the configured failure mode.
 * Deterministic findings survive every L1 answer.
 */
export function mergeL0L1(
  l0: ScanResult,
  l1: SafetyVerdict | null,
  l1Failure?: SafetyDecision,
): SafetyVerdict & { readonly l0Decision: SafetyDecision } {
  const l0Verdict: SafetyVerdict = {
    version: VERDICT_VERSION,
    decision: l0.decision,
    confidence: l0.findings.length > 0 ? Math.max(...l0.findings.map((finding) => finding.confidence)) : 1,
    categories: l0.categories,
    summary: l0.findings.map((finding) => finding.ruleId).join(","),
    policyRuleIds: l0.findings.map((finding) => finding.ruleId),
  };

  const sources = [l0Verdict, ...(l1 !== null ? [l1] : []), ...(l1Failure !== undefined ? [emptyVerdict(l1Failure)] : [])];
  const decision = mergeDecisions(...sources.map((source) => source.decision));
  const categories = [...new Set(sources.flatMap((source) => [...source.categories]))];
  const ruleIds = [...new Set(sources.flatMap((source) => [...(source.policyRuleIds ?? [])]))];
  const winning = sources.find((source) => source.decision === decision);
  const confidence = sources.some((source) => source.decision === decision)
    ? Math.max(...sources.filter((source) => source.decision === decision).map((source) => source.confidence))
    : 1;

  return {
    version: VERDICT_VERSION,
    decision,
    confidence: decision === "allow" ? 1 : confidence,
    categories,
    summary: sources
      .filter((source) => source.decision !== "allow" || source === winning)
      .map((source) => source.summary)
      .filter((summary) => summary.length > 0)
      .join("; "),
    policyRuleIds: ruleIds.length > 0 ? ruleIds : undefined,
    l0Decision: l0.decision,
  };
}

export function isSafetyCategory(category: string): category is SafetyCategory {
  return !QUALITY_CATEGORY_SET.has(category);
}

const QUALITY_CATEGORY_SET: ReadonlySet<string> = new Set<string>([
  "unclear",
  "underspecified",
  "spam",
  "irrelevant",
  "low_information",
  "likely_accidental",
]);

/**
 * Floor decision for a merged verdict based on the category mix and the
 * guard's configured actions (SPEC §4: safety and quality have separate
 * actions; usefulness never blocks unless opted in).
 */
export function decisionForCategories(
  verdict: SafetyVerdict,
  actions: { readonly safety: SafetyDecision; readonly quality: SafetyDecision },
): SafetyDecision {
  const categories = verdict.categories;
  const hasSafety = categories.some((category) => isSafetyCategory(category));
  const hasQuality = categories.some((category) => QUALITY_CATEGORY_SET.has(category));
  if (hasSafety) return mergeDecisions(verdict.decision, actions.safety);
  if (hasQuality) return mergeDecisions(verdict.decision, actions.quality);
  return verdict.decision;
}

/** Audit coordinates shared by every check (design SPEC §23). */
export interface CheckContext {
  readonly direction: CheckDirection;
  readonly channel: ContentChannel;
  readonly sessionId: string | null;
  readonly turn: number | null;
  readonly step: number | null;
  readonly toolName: string | null;
}

export interface CheckOutcome {
  readonly verdict: SafetyVerdict;
  /** Fully merged + mode-applied decision the guard enforces. */
  readonly decision: SafetyDecision;
  readonly l0: ScanResult;
  readonly context: CheckContext;
  readonly startedAt: number;
  readonly latencyMs: number;
  readonly classifier: {
    readonly provider: string;
    readonly model: string;
    readonly ran: boolean;
    readonly failureMode: ResolvedSafetyGateConfig["classifier"]["failureMode"] | null;
  };
}

export function emptyScan(): ScanResult {
  return { findings: [], decision: "allow", categories: [], scannedChars: 0, truncated: false };
}

export function allowOutcome(context: CheckContext): CheckOutcome {
  return {
    verdict: emptyVerdict("allow"),
    decision: "allow",
    l0: emptyScan(),
    context,
    startedAt: 0,
    latencyMs: 0,
    classifier: { provider: "", model: "", ran: false, failureMode: null },
  };
}
