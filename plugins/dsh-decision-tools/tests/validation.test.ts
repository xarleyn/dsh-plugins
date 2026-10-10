import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { answers, questions } from "../src/validate.js";
import { parseResponse } from "../src/client.js";
import type { Question } from "../src/types.js";
const cfg = resolveConfig();
const choice: Question = {
  id: "topic",
  type: "choice",
  instructions: "Choose topic",
  criteria: { bug: "Defect", request: "Feature request" },
};
const score: Question = {
  id: "urgency",
  type: "score",
  instructions: "Rate urgency",
  criteria: ["low", "medium", "high"],
};
describe("configuration and input contracts", () => {
  it("resolves bounded defaults and operator-selected endpoints", () => {
    expect(cfg.maxStateTokens).toBe(2400);
    expect(cfg.maxRequestTokens).toBe(2600);
    expect(
      resolveConfig({
        backends: [
          {
            id: "local",
            baseUrl: "https://scorer.example/v1/systemone",
            apiKeyEnv: "",
          },
        ],
      }).backends[0]?.baseUrl,
    ).toBe("https://scorer.example/v1/systemone");
  });
  it.each([
    { maxConcurrency: 0 },
    { timeoutMs: NaN },
    { noThreshold: 0.8, yesThreshold: 0.7 },
    { maxStateTokens: 2600 },
    { backends: [] },
    {
      backends: [
        { id: "local", baseUrl: "https://user:password@scorer.example" },
      ],
    },
    { backends: [{ id: "local", baseUrl: "file:///tmp/decision" }] },
  ])("refuses unsafe or incoherent config %j", (raw) =>
    expect(() => resolveConfig(raw)).toThrow(),
  );
  it("rejects duplicate ids, unknown kinds, trivial choices and repeated score levels", () => {
    for (const qs of [
      [choice, choice],
      [{ ...choice, type: "other" }],
      [{ ...choice, criteria: { one: null } }],
      [{ ...score, criteria: ["same", "same"] }],
    ])
      expect(() => questions(qs, cfg)).toThrow();
  });
  it("keeps full rich question descriptions", () => {
    const q = {
      ...score,
      criteria: [
        { what: "low", examples: ["cosmetic"] },
        { what: "high", examples: ["blocked"] },
      ],
    };
    expect(questions([q], cfg)).toEqual([q]);
  });
});
describe("response contract", () => {
  it("preserves uncertain noul rather than forcing a boolean", () => {
    const q: Question = {
      id: "check",
      type: "noul",
      instructions: "Is this safe?",
    };
    expect(
      answers({ check: { type: "noul", noul: 0.5 } }, [q], cfg).check,
    ).toMatchObject({ decision: "uncertain", uncertain: true, noul: 0.5 });
  });
  it("preserves a score independently of tempered display probabilities", () => {
    const a = {
      type: "score",
      score: 1.7,
      confidence: 0.2,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { "0": 0.3, "1": 0.3, "2": 0.4 },
    };
    expect(answers({ urgency: a }, [score], cfg).urgency).toMatchObject({
      score: 1.7,
      uncertain: true,
      probabilities: a.probabilities,
    });
  });
  it.each([
    {
      topic: {
        type: "choice",
        choice: "unknown",
        confidence: 1,
        probabilities: { bug: 0.8, request: 0.2 },
      },
    },
    {
      topic: {
        type: "choice",
        choice: "request",
        confidence: 1,
        probabilities: { bug: 0.8, request: 0.2 },
      },
    },
    {
      topic: {
        type: "choice",
        choice: "bug",
        confidence: NaN,
        probabilities: { bug: 0.8, request: 0.2 },
      },
    },
    {
      topic: {
        type: "choice",
        choice: "bug",
        confidence: 1,
        probabilities: { bug: 1, request: 1 },
      },
    },
    {
      topic: {
        type: "choice",
        choice: "bug",
        confidence: 1,
        probabilities: { bug: 1 },
      },
    },
    { topic: { type: "noul", noul: 1 } },
    {},
    { topic: {}, extra: {} },
  ])("rejects malformed or misaligned choice answers %j", (value) =>
    expect(() => answers(value, [choice], cfg)).toThrow(/INVALID_RESPONSE/),
  );
  it("rejects score overflow and altered legend", () => {
    const a = {
      type: "score",
      score: 3,
      confidence: 0.8,
      legend: { "0": "low", "1": "medium", "2": "high" },
      probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 },
    };
    expect(() => answers({ urgency: a }, [score], cfg)).toThrow();
    expect(() =>
      answers(
        {
          urgency: {
            ...a,
            score: 1,
            legend: { "0": "changed", "1": "medium", "2": "high" },
          },
        },
        [score],
        cfg,
      ),
    ).toThrow(/legend/);
  });
  it("rejects duplicate JSON keys including escaped keys", () => {
    expect(() => parseResponse('{"answers":{"a":1,"\\u0061":2}}')).toThrow(
      /duplicate/,
    );
    expect(parseResponse('{"a":{"x":1},"b":{"x":2},"c":["a","a"]}')).toEqual({
      a: { x: 1 },
      b: { x: 2 },
      c: ["a", "a"],
    });
  });
});
