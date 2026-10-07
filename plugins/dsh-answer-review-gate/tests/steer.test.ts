/**
 * The model-facing steers the gate sends back into the primary.
 *
 * A revision demand admits exactly one visible artifact — the answer the user
 * asked for — because the earlier text asked for a stated disproof of a
 * rejected objection in the same breath as it forbade the review in the answer,
 * and a live primary resolved that contradiction by opening the user's final
 * answer with its argument against the reviewer. Neither demand is phrased as a
 * secret either: a visible thinking block that reasons about a concealment
 * instruction reports the instruction.
 */

import { describe, expect, it } from "vitest";

import {
  renderAnswerShapeSteer,
  renderQualificationSteer,
  renderRevisionSteer,
} from "../src/prompt.js";
import type { ReviewVerdict } from "../src/types.js";

const REVISE: ReviewVerdict = {
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
  confidence: "medium",
};

/** A rule that asks the primary to hide the review is the leak, not the guard. */
function expectNoConcealmentRule(text: string): void {
  expect(text).not.toMatch(
    /\b(do not|don't|never|must not) (mention|reveal|disclose|cite|refer to|allude)\b/iu,
  );
  expect(text).not.toMatch(/\b(hidden|secret|concealed|confidential)\b/iu);
}

describe("renderRevisionSteer", () => {
  const steer = renderRevisionSteer(REVISE, 1, 3);

  it("hands the findings back as delimited working material", () => {
    expect(steer).toContain("round 1 of 3");
    expect(steer).toContain("<review_notes>");
    expect(steer).toContain("Reviewer summary: One claim is unsupported.");
    expect(steer).toContain(
      "- [major/unsupported] The default is 512 — No source states this Required fix: Verify against the code",
    );
    expect(steer).toContain("</review_notes>");
  });

  it("demands the corrected answer as the only visible artifact", () => {
    expect(steer).toContain("exactly one artifact");
    expect(steer).toContain("the corrected answer");
  });

  it("never asks the primary to state a disproof of a finding", () => {
    expect(steer).not.toMatch(/state (that|the) disproof/iu);
    expect(steer).not.toMatch(/must state/iu);
  });

  it("carries no concealment rule", () => {
    expectNoConcealmentRule(steer);
  });

  it("keeps the block even when the reviewer sent no findings", () => {
    const summaryOnly = renderRevisionSteer({ ...REVISE, issues: [] }, 2, 3);
    expect(summaryOnly).toContain("<review_notes>");
    expect(summaryOnly).not.toContain("Findings:");
  });

  it("carries the summary only when the reviewer wrote one", () => {
    const findingsOnly = renderRevisionSteer({ ...REVISE, summary: "" }, 1, 3);
    expect(findingsOnly).not.toContain("Reviewer summary:");
    expect(findingsOnly).toContain("Findings:");
  });
});

describe("renderAnswerShapeSteer", () => {
  const steer = renderAnswerShapeSteer();

  it("demands the request's answer alone", () => {
    expect(steer).toContain("answer alone");
    expect(steer).toContain("working material");
  });

  it("carries no concealment rule", () => {
    expectNoConcealmentRule(steer);
  });

  it("names nothing the answer should echo back", () => {
    expect(steer).not.toMatch(/вывод ревизора|опровержени/u);
  });
});

describe("failure-policy steers", () => {
  it("ask for an honest qualification, not for concealment", () => {
    const steer = renderQualificationSteer("provider down");
    expect(steer).toContain("did not complete");
    expectNoConcealmentRule(steer);
  });
});
