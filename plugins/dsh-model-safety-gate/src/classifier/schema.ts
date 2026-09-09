/**
 * Verdict parsing and validation for classifier backends (design SPEC §5).
 *
 * Classifier output is untrusted: it is parsed strictly, validated against
 * the verdict schema, and anything malformed becomes a classifier failure
 * (`SAFETY_CLASSIFIER_INVALID_RESPONSE`), never a silently accepted verdict.
 */

import { SAFETY_CATEGORIES, QUALITY_CATEGORIES, DECISION_ORDER, SafetyGateError, VERDICT_VERSION } from "../types.js";
import type { SafetyDecision, SafetyVerdict } from "../types.js";

const VALID_DECISIONS: ReadonlySet<string> = new Set(["allow", "warn", "review", "block"]);
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([...SAFETY_CATEGORIES, ...QUALITY_CATEGORIES]);

/** Raw parsed shape before validation; every field is `unknown` here. */
interface RawVerdict {
  decision?: unknown;
  confidence?: unknown;
  categories?: unknown;
  summary?: unknown;
  policyRuleIds?: unknown;
}

/** Pull the first JSON object out of a possibly chatty model answer. */
export function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced !== null ? fenced[1] ?? "" : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "classifier answer contains no JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "classifier answer is not valid JSON", { cause: error });
  }
  return parsed;
}

/**
 * Validate a parsed payload into a `SafetyVerdict`. Throws
 * `SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE")` on any schema
 * violation — unknown decision, out-of-range confidence, non-array
 * categories, oversized summary, or a downgrade-below-allow attempt.
 */
export function validateVerdict(payload: unknown, maxSummaryChars = 500): SafetyVerdict {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "verdict must be a JSON object");
  }
  const raw = payload as RawVerdict;

  const decision = raw.decision;
  if (typeof decision !== "string" || !VALID_DECISIONS.has(decision)) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", `verdict decision must be one of allow|warn|review|block (got ${JSON.stringify(decision)})`);
  }

  const confidence = raw.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "verdict confidence must be a number in [0, 1]");
  }

  const categories = raw.categories;
  if (!Array.isArray(categories) || categories.some((category) => typeof category !== "string") || categories.length > 16) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "verdict categories must be an array of at most 16 strings");
  }
  for (const category of categories as string[]) {
    if (!KNOWN_CATEGORIES.has(category)) {
      throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", `verdict category "${category}" is not part of the schema`);
    }
  }

  const summary = raw.summary;
  if (typeof summary !== "string" || summary.length > maxSummaryChars) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", `verdict summary must be a string of at most ${maxSummaryChars} characters`);
  }

  let policyRuleIds: string[] | undefined;
  if (raw.policyRuleIds !== undefined) {
    if (!Array.isArray(raw.policyRuleIds) || raw.policyRuleIds.some((id) => typeof id !== "string")) {
      throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "verdict policyRuleIds must be an array of strings");
    }
    policyRuleIds = (raw.policyRuleIds as string[]).slice(0, 16);
  }

  const finalDecision = decision as SafetyDecision;
  if (DECISION_ORDER[finalDecision] < DECISION_ORDER.allow) {
    throw new SafetyGateError("SAFETY_CLASSIFIER_INVALID_RESPONSE", "verdict decision is out of range");
  }

  return {
    version: VERDICT_VERSION,
    decision: finalDecision,
    confidence,
    categories: categories as SafetyVerdict["categories"],
    summary,
    ...(policyRuleIds !== undefined ? { policyRuleIds } : {}),
  };
}
