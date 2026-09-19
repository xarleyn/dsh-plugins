import { describe, expect, it } from "vitest";
import { fitState, STATE_CONTEXT } from "../../src/jev/state.js";
import { questionsFor } from "../../src/jev/questions.js";
import { batchCandidates, mapWithConcurrency } from "../../src/jev/batch.js";
import { estimateStateTokens, type JevState } from "../../src/jev/types.js";
import {
  validateJevResponse,
  JevInvalidResponseError,
} from "../../src/jev/validate.js";
import type { ToolResultCandidate } from "../../src/planner/collect.js";
import { SessionSeq } from "@deepseek-ai/dsh-session";

function candidate(
  callId: string,
  seq: number,
  text: string,
): ToolResultCandidate {
  return {
    surfaceSeq: SessionSeq(seq),
    callId,
    toolName: "read",
    turn: 1,
    step: 1,
    originalText: text,
    originalChars: text.length,
    isError: false,
    agePositions: 5,
    toolArgumentsPreview: JSON.stringify({ path: "src/a.ts" }),
  };
}

describe("state fitting", () => {
  it("keeps full state under the budget", () => {
    const state: JevState = {
      context: STATE_CONTEXT,
      goal: "fix tests",
      history: [{ label: "user t1", text: "fix the tests" }],
    };
    const fitted = fitState(state, 100000);
    expect(fitted.stage).toBe("full");
    expect(fitted.state.history).toHaveLength(1);
  });

  it("shrinks through stages until it fits, deterministically", () => {
    const history = Array.from({ length: 40 }, (_, index) => ({
      label: `tool t1/c${index}`,
      callId: `c${index}`,
      text: `id=c${index} name=read result=ok, ${index} chars omitted features=none`,
    }));
    const state: JevState = { context: STATE_CONTEXT, goal: "g", history };
    const fitted = fitState(state, 1200);
    expect(fitted.tokens).toBeLessThanOrEqual(1200);
    expect(fitted.stage).not.toBe("full");
    expect(fitted.state.goal).toBe("g");
    const again = fitState(state, 1200);
    expect(again.state).toEqual(fitted.state);
  });

  it("throws when even the last stage cannot fit", () => {
    const state: JevState = {
      context: STATE_CONTEXT,
      goal: "x".repeat(40_000),
      history: [],
    };
    expect(() => fitState(state, 1200)).toThrow(/cannot fit/);
  });
});

describe("questions and batching", () => {
  it("builds two questions per candidate with stable names", () => {
    const questions = questionsFor([
      candidate("t1", 5, "x"),
      candidate("t2", 6, "y"),
    ]);
    expect(questions.map((question) => question.name)).toEqual([
      "needContents_t1",
      "needVerbatim_t1",
      "needContents_t2",
      "needVerbatim_t2",
    ]);
  });

  it("splits candidates so state plus questions fit one request", () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate(`c${index}`, index, "x"),
    );
    const stateTokens = 29500;
    const maxRequestTokens = 30000;
    const batches = batchCandidates(candidates, stateTokens, maxRequestTokens);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(candidates);
    for (const batch of batches) {
      const questionTokens = estimateStateTokens(
        JSON.stringify(questionsFor(batch)),
      );
      expect(stateTokens + questionTokens).toBeLessThanOrEqual(
        maxRequestTokens,
      );
    }
  });

  it("runs batches with bounded concurrency and preserves order", async () => {
    const order: number[] = [];
    const results = await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      2,
      async (value) => {
        order.push(value);
        return value * 2;
      },
    );
    expect(results).toEqual([0, 2, 4, 6, 8]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("response validation", () => {
  const questions = questionsFor([candidate("t1", 5, "x")]);

  it("accepts a valid answers object", () => {
    const body = JSON.stringify({
      answers: {
        needContents_t1: { noul: 0.3 },
        needVerbatim_t1: { noul: 0.8 },
      },
    });
    const answers = validateJevResponse(body, questions);
    expect(answers.get("needContents_t1")).toBe(0.3);
  });

  it("rejects malformed JSON, missing answers, and missing keys", () => {
    expect(() => validateJevResponse("not json", questions)).toThrow(
      JevInvalidResponseError,
    );
    expect(() => validateJevResponse("{}", questions)).toThrow(
      JevInvalidResponseError,
    );
    expect(() =>
      validateJevResponse(
        JSON.stringify({ answers: { needContents_t1: { noul: 0.3 } } }),
        questions,
      ),
    ).toThrow(/needVerbatim_t1/);
  });

  it("rejects NaN and out-of-range probabilities", () => {
    const bad = (noul: number): string =>
      JSON.stringify({
        answers: { needContents_t1: { noul }, needVerbatim_t1: { noul: 0.5 } },
      });
    expect(() => validateJevResponse(bad(Number.NaN), questions)).toThrow(
      /needContents_t1/,
    );
    expect(() => validateJevResponse(bad(1.5), questions)).toThrow(
      /out of range/,
    );
    expect(() => validateJevResponse(bad(-0.1), questions)).toThrow(
      /out of range/,
    );
  });
});
