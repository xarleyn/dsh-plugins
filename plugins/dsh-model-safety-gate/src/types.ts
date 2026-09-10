/**
 * Domain types of the dsh-model-safety-gate plugin (SPEC.md §1–§3).
 *
 * These types are the plugin's public contract: the verdict schema consumed by
 * guards, the classifier backends, and the audit layer. They are
 * DSH-independent on purpose so the classification core stays testable in
 * isolation.
 */

/** Verdict schema version. Bumped on incompatible changes to `SafetyVerdict`. */
export const VERDICT_VERSION = 1 as const;

/** Final enforcement decisions, ordered by escalation strength. */
export type SafetyDecision = "allow" | "warn" | "review" | "block";

/** Decision ordering used by the monotonic merge (SPEC §19). */
export const DECISION_ORDER: Readonly<Record<SafetyDecision, number>> = {
  allow: 0,
  warn: 1,
  review: 2,
  block: 3,
};

/** Safety categories that can justify a hard block (SPEC §4). */
export type SafetyCategory =
  | "prompt_injection"
  | "jailbreak"
  | "credential_exfiltration"
  | "secret_leak"
  | "destructive_intent"
  | "unsafe_tool_intent"
  | "policy_violation"
  | "malicious_instruction"
  | "unknown_high_risk";

export const SAFETY_CATEGORIES: readonly SafetyCategory[] = [
  "prompt_injection",
  "jailbreak",
  "credential_exfiltration",
  "secret_leak",
  "destructive_intent",
  "unsafe_tool_intent",
  "policy_violation",
  "malicious_instruction",
  "unknown_high_risk",
];

/**
 * Usefulness categories. They never hard-block by default (SPEC §4):
 * the small model may report "this request looks random/pointless" and DSH
 * still sends it.
 */
export type QualityCategory =
  | "unclear"
  | "underspecified"
  | "spam"
  | "irrelevant"
  | "low_information"
  | "likely_accidental";

export const QUALITY_CATEGORIES: readonly QualityCategory[] = [
  "unclear",
  "underspecified",
  "spam",
  "irrelevant",
  "low_information",
  "likely_accidental",
];

/** Structured classifier result; malformed shapes are classifier failures. */
export interface SafetyVerdict {
  readonly version: typeof VERDICT_VERSION;
  readonly decision: SafetyDecision;
  /** 0.0 – 1.0. */
  readonly confidence: number;
  readonly categories: readonly (SafetyCategory | QualityCategory | string)[];
  readonly summary: string;
  readonly policyRuleIds?: readonly string[];
}

/**
 * Which stream of content a check ran against. Reasoning and visible answer
 * carry separate policies (SPEC §10, §14).
 */
export type ContentChannel = "input" | "text" | "reasoning" | "tool" | "tool-result";

/** Deterministic L0 finding for a single matched rule. */
export interface ScanFinding {
  /** Stable rule identifier, e.g. `injection.ignore_previous`. */
  readonly ruleId: string;
  readonly category: SafetyCategory;
  /** Hard red lines are `block`; softer signals are `warn`. */
  readonly severity: Exclude<SafetyDecision, "allow" | "review">;
  /** Matched span length in characters on the folded text. */
  readonly spanLength: number;
  /** Confidence assigned by the rule author, 0–1. */
  readonly confidence: number;
}

/** Result of running the L0 scanner over one piece of content. */
export interface ScanResult {
  readonly findings: readonly ScanFinding[];
  readonly decision: SafetyDecision;
  readonly categories: readonly SafetyCategory[];
  /** Folded/decoded content char count that was actually scanned. */
  readonly scannedChars: number;
  /** True when content exceeded the scan budget and was truncated. */
  readonly truncated: boolean;
}

/** Where a check happened, for audit records (SPEC §23). */
export type CheckDirection = "input" | "output" | "tools" | "tool-results";

/** Stable plugin error codes (SPEC §31). Never match on message strings. */
export type SafetyErrorCode =
  | "SAFETY_INVALID_ARGUMENT"
  | "SAFETY_INPUT_BLOCKED"
  | "SAFETY_OUTPUT_BLOCKED"
  | "SAFETY_REASONING_BLOCKED"
  | "SAFETY_TOOL_BLOCKED"
  | "SAFETY_CLASSIFIER_TIMEOUT"
  | "SAFETY_CLASSIFIER_INVALID_RESPONSE"
  | "SAFETY_CLASSIFIER_UNAVAILABLE"
  | "SAFETY_BUFFER_OVERFLOW";

/** Typed plugin error carrying a stable `code` (guidelines §5.2). */
export class SafetyGateError extends Error {
  readonly code: SafetyErrorCode;

  constructor(code: SafetyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    this.name = "SafetyGateError";
    this.code = code;
  }
}
