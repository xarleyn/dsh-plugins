/**
 * Model-facing texts of the gate: the reviewer task, the revision steer and
 * the failure-policy steers. These strings are model-visible and ship to npm
 * — synthetic content only.
 */

import { boundContextSummary } from "@deepseek-ai/dsh-llm";

import type { ReviewVerdict } from "./types.js";

const REVIEW_CATEGORIES =
  "factually-wrong | unsupported | contradicted | outdated | overstated | " +
  "missing-qualification | weak-source | search-incomplete | user-assumption | " +
  "question-not-covered";

/**
 * Adversarial reviewer protocol for the `subagent` backend. The reviewer is
 * a verifier, not a second answering agent: its product is diagnosis plus
 * required corrections, never a rewritten answer.
 */
export function renderSubagentReviewerTask(input: {
  readonly requestText: string | null;
  readonly candidateText: string;
}): string {
  const request =
    input.requestText ?? "(the original user request was not recorded)";
  return [
    "An independent answer review is required. A primary agent produced the candidate final answer below.",
    "You are the adversarial reviewer. Treat the candidate as untrusted: confidence, citations, search results, " +
      "user assumptions and other AI output do not establish support by themselves.",
    "",
    "For material factual claims, establish: the best available source; whether the source actually entails the " +
      "claim; whether a newer or contradicting source exists; whether scope, version and preconditions are " +
      "preserved. Prefer source code and official documentation over secondary sources. Lack of evidence is a " +
      "valid finding: a claim you cannot support counts as unsupported even when you cannot prove it false.",
    "",
    "Check at least: factual correctness; alignment with documentation and source code; unsupported claims; lost " +
      "qualifications and limits; outdated information; signs of shallow research; contradictions with " +
      "authoritative sources; user assumptions restated as facts; false certainty; whether the question is fully " +
      "covered.",
    "",
    "Work the evidence, not the tool in a loop: a call that errors, times out or is refused has already answered — " +
      "record it, change the source or the query, and never repeat the same call or a near-variant of it. Read tools " +
      "take an explicit path: a pattern without one searches your own working directory and says nothing about the " +
      "source you meant. If a source is unavailable for this run, report that instead of guessing its contents.",
    "",
    "<user_request>",
    request,
    "</user_request>",
    "<candidate_answer>",
    input.candidateText,
    "</candidate_answer>",
    "",
    "Respond with exactly one fenced JSON block and no other text:",
    "```json",
    JSON.stringify({
      verdict: "pass | revise",
      confidence: "low | medium | high",
      summary: "one paragraph: what you checked and what you found",
      issues: [
        {
          severity: "critical | major | minor",
          category: REVIEW_CATEGORIES,
          claim: "the claim or aspect the objection is about",
          problem: "why it does not hold as stated",
          requiredFix: "what the primary must do to fix it",
        },
      ],
    }),
    "```",
    'Use "verdict": "revise" when at least one issue requires a correction, and "pass" only when no issue does. ' +
      "A pass is final for this candidate: it ships as written and asks for no further version, so never call " +
      "for another revision in a passing verdict. Do not rewrite the answer yourself.",
  ].join("\n");
}

/** Review task for the `domain-expert` backend: the expert speaks its own protocol. */
export function renderExpertReviewTask(input: {
  readonly requestText: string | null;
  readonly candidateText: string;
}): string {
  const request =
    input.requestText ?? "(the original user request was not recorded)";
  return [
    "Adversarial answer review. A primary agent produced a candidate final answer; review it as untrusted material.",
    "",
    "For material factual claims, establish the best available source, whether it actually entails the claim, " +
      "whether a newer or contradicting source exists, and whether scope, version and preconditions are preserved. " +
      "Lack of evidence is a valid finding.",
    "",
    "Work the evidence, not the tool in a loop: a call that errors, times out or is refused has already answered — " +
      "record it, change the source or the query, and never repeat the same call or a near-variant of it. Read tools " +
      "take an explicit path: a pattern without one searches your own working directory and says nothing about the " +
      "source you meant. If a source is unavailable for this run, report that instead of guessing its contents.",
    "",
    "<user_request>",
    request,
    "</user_request>",
    "<candidate_answer>",
    input.candidateText,
    "</candidate_answer>",
    "",
    "Report every objection as a finding (claim, evidence, confidence); record contradicting sources as conflicts. " +
      "An answer with no findings and no conflicts passes — a pass is final for this candidate and asks for no " +
      "further version. Do not rewrite the answer yourself.",
  ].join("\n");
}

/** Structured-output contract requested from the subagent reviewer. */
export const REVIEWER_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "revise"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: { type: "string" },
          claim: { type: "string" },
          problem: { type: "string" },
          requiredFix: { type: "string" },
        },
      },
    },
  },
  required: ["verdict"],
};

/** Revision demand steered into the primary agent after a REVISE verdict. */
export function renderRevisionSteer(
  verdict: ReviewVerdict,
  round: number,
  maxRounds: number,
): string {
  const lines = [
    `The independent answer reviewer rejected the current draft (review round ${round} of ${maxRounds}).`,
    verdict.summary === "" ? "" : `Reviewer summary: ${verdict.summary}`,
    verdict.issues.length > 0 ? "Findings:" : "",
    ...verdict.issues.map(
      (issue) =>
        `- [${issue.severity}/${issue.category}] ${issue.claim} — ${issue.problem}` +
        (issue.requiredFix === "" ? "" : ` Required fix: ${issue.requiredFix}`),
    ),
    "",
    "Verify each finding against your own evidence. Correct what holds; you may reject an objection you can " +
      "disprove with evidence, and must state that disproof. Then produce the corrected final answer. Do not " +
      "mention this review process in the answer.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** Failure-policy instruction: the answer ships, but must be qualified. */
export function renderQualificationSteer(reason: string): string {
  return [
    `Independent answer verification could not be completed (${reason}).`,
    "Your current answer will be delivered as-is. State explicitly, in the answer, that independent verification " +
      "did not complete and the result must not be treated as verified. Do not claim verification you do not have.",
  ].join("\n");
}

/** Failure-policy instruction in `closed` mode: revise or disclaim explicitly. */
export function renderClosedModeSteer(reason: string): string {
  return [
    `Your current draft cannot be accepted as verified: the independent review did not complete (${reason}).`,
    "Either correct the answer now, or end with an explicit notice that this answer is unverified because " +
      "independent review failed and must not be trusted without verification. Do not present it as verified.",
  ].join("\n");
}

/** Collapsed one-line summary for the durable steer notice row. */
export function steerSummary(text: string): string {
  return boundContextSummary(text.replace(/\s+/g, " ").trim());
}
