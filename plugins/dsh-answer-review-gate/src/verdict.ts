/**
 * Verdict parsing and derivation (`SPEC.md`, "Reviewer contract", "Security").
 *
 * Reviewer output is untrusted model output. Every path here either produces
 * a validated `ReviewVerdict` or throws `ReviewerFailure` — a malformed
 * verdict is a reviewer failure, never a PASS.
 */

import { ReviewerFailure } from "./types.js";
import type {
  ExpertRunResult,
  ReviewCategory,
  ReviewIssue,
  ReviewSeverity,
  ReviewVerdict,
} from "./types.js";

const SEVERITIES: readonly ReviewSeverity[] = ["critical", "major", "minor"];
const CATEGORIES: readonly ReviewCategory[] = [
  "factually-wrong",
  "unsupported",
  "contradicted",
  "outdated",
  "overstated",
  "missing-qualification",
  "weak-source",
  "search-incomplete",
  "user-assumption",
  "question-not-covered",
];
const CONFIDENCES: readonly ReviewVerdict["confidence"][] = [
  "low",
  "medium",
  "high",
];

const FENCE_PATTERN = /```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/gu;

/** Validate an already-structured verdict object (lenient on issue fields). */
export function validateReviewerVerdict(value: unknown): ReviewVerdict {
  if (typeof value !== "object" || value === null) {
    throw new ReviewerFailure("malformed-verdict", "verdict is not an object");
  }
  const raw = value as Record<string, unknown>;
  const verdict = raw["verdict"];
  if (verdict !== "pass" && verdict !== "revise") {
    throw new ReviewerFailure(
      "malformed-verdict",
      `verdict must be "pass" or "revise", got ${JSON.stringify(verdict)}`,
    );
  }
  const issues = parseIssues(raw["issues"]);
  const confidence = CONFIDENCES.includes(raw["confidence"] as never)
    ? (raw["confidence"] as ReviewVerdict["confidence"])
    : "medium";
  const summary = typeof raw["summary"] === "string" ? raw["summary"] : "";
  return { verdict, summary, issues, confidence };
}

/**
 * Parse a verdict out of reviewer text: a fenced JSON block (preferred) or a
 * bare JSON object anywhere in the text. Absence of a parseable verdict is a
 * reviewer failure.
 */
export function parseReviewerVerdict(text: string): ReviewVerdict {
  for (const candidate of extractJsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    // A parseable object with a wrong shape is still malformed output; keep
    // scanning only when the object could not be a verdict at all.
    if (typeof parsed === "object" && parsed !== null && "verdict" in parsed) {
      return validateReviewerVerdict(parsed);
    }
  }
  throw new ReviewerFailure(
    "malformed-verdict",
    "no verdict JSON found in reviewer output",
  );
}

/** Extract fenced JSON bodies first, then one bare-object fallback. */
function extractJsonCandidates(text: string): readonly string[] {
  const candidates: string[] = [];
  FENCE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FENCE_PATTERN)) {
    const body = match[1];
    if (body !== undefined && body.trim().startsWith("{"))
      candidates.push(body);
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates;
}

function parseIssues(value: unknown): readonly ReviewIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ReviewIssue[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const severity = SEVERITIES.includes(raw["severity"] as never)
      ? (raw["severity"] as ReviewSeverity)
      : "major";
    const category = CATEGORIES.includes(raw["category"] as never)
      ? (raw["category"] as ReviewCategory)
      : "unsupported";
    issues.push({
      severity,
      category,
      claim: typeof raw["claim"] === "string" ? raw["claim"] : "",
      problem: typeof raw["problem"] === "string" ? raw["problem"] : "",
      requiredFix:
        typeof raw["requiredFix"] === "string" ? raw["requiredFix"] : "",
    });
  }
  return issues;
}

/**
 * Derive a verdict from a domain-expert run (`SPEC.md`, "Domain Experts
 * integration"). The expert speaks its own structured protocol (findings,
 * conflicts); findings and conflicts ARE the review objections, so an empty
 * set passes and anything else demands revision.
 */
export function deriveVerdictFromExpertResult(
  result: ExpertRunResult,
): ReviewVerdict {
  if (result.status !== "completed") {
    throw new ReviewerFailure(
      "expert-not-completed",
      `expert run ended with status "${result.status}"`,
    );
  }
  const issues: ReviewIssue[] = [
    ...result.findings.map((finding) => ({
      severity: "major" as const,
      category: "unsupported" as const,
      claim: finding.claim,
      problem:
        finding.evidence.length > 0
          ? `Reviewer objection, evidence: ${finding.evidence.join("; ")}`
          : "Reviewer objection without recorded evidence.",
      requiredFix: "",
    })),
    ...result.conflicts.map((conflict) => ({
      severity: "major" as const,
      category: "contradicted" as const,
      claim: conflict,
      problem: "Reviewer recorded conflicting sources for this point.",
      requiredFix: "",
    })),
  ];
  return {
    verdict: issues.length === 0 ? "pass" : "revise",
    summary: result.summary,
    issues,
    confidence: "medium",
  };
}
