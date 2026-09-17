import { describe, expect, it } from "vitest";
import {
  asRecord,
  asString,
  asStringArray,
  normalizeConfidence,
  normalizeEvidenceLevel,
  normalizeOutcome,
  normalizePriority,
  normalizeSeverity,
  normalizeVerdict,
  readFinding,
  readScorecard,
  severityRank,
} from "../src/index.js";

describe("value readers", () => {
  it("treats a blank string as absent", () => {
    expect(asString("  ")).toBeUndefined();
    expect(asString(" x ")).toBe("x");
    expect(asString(7)).toBeUndefined();
  });

  it("keeps only the strings in a mixed array", () => {
    expect(asStringArray(["a", 1, null, "b", {}])).toEqual(["a", "b"]);
    expect(asStringArray("not an array")).toEqual([]);
  });

  it("refuses an array as a record", () => {
    expect(asRecord([1])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("fills absent finding fields instead of failing the row", () => {
    const finding = readFinding({ id: "F1" });
    expect(finding).toEqual({
      id: "F1",
      severity: "",
      category: "",
      title: "",
      status: "",
      rootCause: "",
      description: "",
      evidence: [],
      recommendationTarget: "",
    });
    expect(readFinding("not an object")).toBeUndefined();
  });

  it("keeps scorecard entries that are objects and drops the rest", () => {
    const scorecard = readScorecard({
      ok: { score: 2, confidence: "high", summary: "s", evidence: ["seq:1"] },
      broken: 5,
      hollow: {},
    });
    expect(Object.keys(scorecard)).toEqual(["ok", "hollow"]);
    expect(scorecard.ok?.score).toBe(2);
    expect(scorecard.hollow?.score).toBeNull();
  });
});

describe("normalisation", () => {
  it("maps a known verdict and passes an unknown one to the fallback", () => {
    expect(normalizeVerdict("Good")).toBe("good");
    expect(normalizeVerdict("triumphant")).toBe("unknown");
    expect(normalizeVerdict(undefined)).toBe("unknown");
  });

  it("maps severities and ranks them most-severe-first", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("catastrophic")).toBe("other");
    expect(severityRank("critical")).toBeLessThan(severityRank("major"));
    expect(severityRank("major")).toBeLessThan(severityRank("minor"));
    expect(severityRank("observation")).toBeLessThan(severityRank("other"));
  });

  it("normalises the remaining vocabularies", () => {
    expect(normalizeOutcome("completed_with_gaps")).toBe("completed_with_gaps");
    expect(normalizeOutcome("nope")).toBe("unknown");
    expect(normalizeEvidenceLevel("rich")).toBe("rich");
    expect(normalizeEvidenceLevel("")).toBe("unknown");
    expect(normalizeConfidence("Medium")).toBe("medium");
    expect(normalizePriority("high")).toBe("high");
    expect(normalizePriority("urgent")).toBe("unknown");
  });
});
