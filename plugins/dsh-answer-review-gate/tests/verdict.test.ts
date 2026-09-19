import { describe, expect, it } from "vitest";

import {
  deriveVerdictFromExpertResult,
  parseReviewerVerdict,
  validateReviewerVerdict,
} from "../src/verdict.js";
import { ReviewerFailure } from "../src/types.js";

describe("validateReviewerVerdict", () => {
  it("accepts a valid verdict", () => {
    expect(
      validateReviewerVerdict({
        verdict: "pass",
        confidence: "high",
        summary: "Everything checked out.",
        issues: [],
      }),
    ).toEqual({
      verdict: "pass",
      confidence: "high",
      summary: "Everything checked out.",
      issues: [],
    });
  });

  it("rejects a non-object or missing verdict kind", () => {
    expect(() => validateReviewerVerdict(null)).toThrow(ReviewerFailure);
    expect(() => validateReviewerVerdict("pass")).toThrow(ReviewerFailure);
    expect(() => validateReviewerVerdict({ verdict: "maybe" })).toThrow(
      ReviewerFailure,
    );
    expect(() => validateReviewerVerdict({})).toThrow(ReviewerFailure);
  });

  it("normalizes unknown issue fields instead of trusting the reviewer", () => {
    const verdict = validateReviewerVerdict({
      verdict: "revise",
      issues: [
        {
          severity: "catastrophic",
          category: "vibes",
          claim: "The API is stable",
          problem: "No evidence given",
        },
        "garbage-entry",
        { claim: 42 },
      ],
      confidence: "absurd",
    });
    expect(verdict.confidence).toBe("medium");
    expect(verdict.issues).toHaveLength(2);
    expect(verdict.issues[0]).toMatchObject({
      severity: "major",
      category: "unsupported",
      claim: "The API is stable",
    });
    expect(verdict.issues[1]).toMatchObject({ claim: "", problem: "" });
  });
});

describe("parseReviewerVerdict", () => {
  it("parses a fenced JSON verdict with surrounding prose", () => {
    const text = [
      "I checked the claims against the sources.",
      "```json",
      JSON.stringify({
        verdict: "revise",
        summary: "One claim is unsupported.",
        issues: [
          {
            severity: "major",
            category: "unsupported",
            claim: "The default is 512",
            problem: "No source states this",
            requiredFix: "Verify against the code",
          },
        ],
      }),
      "```",
    ].join("\n");
    const verdict = parseReviewerVerdict(text);
    expect(verdict.verdict).toBe("revise");
    expect(verdict.issues).toHaveLength(1);
  });

  it("falls back to a bare JSON object", () => {
    const verdict = parseReviewerVerdict(
      'verdict follows: {"verdict":"pass","summary":"ok","issues":[]}',
    );
    expect(verdict.verdict).toBe("pass");
  });

  it("treats missing or unparseable verdicts as reviewer failures", () => {
    expect(() => parseReviewerVerdict("no structured verdict here")).toThrow(
      ReviewerFailure,
    );
    expect(() => parseReviewerVerdict("```json\n{not json}\n```")).toThrow(
      ReviewerFailure,
    );
    expect(() => parseReviewerVerdict('{"verdict":"pass"')).toThrow(
      ReviewerFailure,
    );
  });
});

describe("deriveVerdictFromExpertResult", () => {
  it("passes an expert run with no findings and no conflicts", () => {
    const verdict = deriveVerdictFromExpertResult({
      status: "completed",
      summary: "Checked; no objections.",
      findings: [],
      conflicts: [],
    });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.issues).toHaveLength(0);
  });

  it("maps findings and conflicts to issues and demands revision", () => {
    const verdict = deriveVerdictFromExpertResult({
      status: "completed",
      summary: "Two objections.",
      findings: [
        {
          claim: "Timeout defaults to 30s",
          evidence: ["config.md"],
          confidence: "high",
        },
        { claim: "No retry on 429", evidence: [], confidence: "low" },
      ],
      conflicts: ["config.md contradicts changelog.md"],
    });
    expect(verdict.verdict).toBe("revise");
    expect(verdict.issues).toHaveLength(3);
    expect(verdict.issues[0]).toMatchObject({
      severity: "major",
      category: "unsupported",
      claim: "Timeout defaults to 30s",
    });
    expect(verdict.issues[2]).toMatchObject({
      category: "contradicted",
      claim: "config.md contradicts changelog.md",
    });
  });

  it("treats a non-completed expert run as a reviewer failure", () => {
    expect(() =>
      deriveVerdictFromExpertResult({
        status: "aborted",
        summary: "",
        findings: [],
        conflicts: [],
      }),
    ).toThrow(ReviewerFailure);
  });
});
