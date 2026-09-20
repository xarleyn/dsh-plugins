/**
 * Deterministic analysis: line-shape normalization, run clustering and pins
 * (result-shaping SPEC §15-§17).
 */

import { describe, expect, it } from "vitest";

import { analyzeText, splitLines } from "../../src/result-shaping/cluster.js";
import { lineShape } from "../../src/result-shaping/normalize.js";
import {
  matchesImportant,
  pinnedLines,
} from "../../src/result-shaping/pins.js";

describe("lineShape", () => {
  it("normalizes values that vary between runs of the same work", () => {
    expect(lineShape("Downloading package foo 12%")).toBe(
      lineShape("Downloading package foo 13%"),
    );
    expect(lineShape("[12:01:04] test alpha passed in 31ms")).toBe(
      lineShape("[12:01:05] test alpha passed in 31ms"),
    );
    expect(lineShape("2026-09-20T12:01:04.512Z step 1234 done")).toBe(
      lineShape("2026-09-20T12:01:05.900Z step 9876 done"),
    );
    expect(lineShape("install 550e8400-e29b-41d4-a716-446655440000 ok")).toBe(
      lineShape("install 550e8400-e29b-41d4-a716-446655440111 ok"),
    );
    expect(
      lineShape("blob 0123456789abcdef0123456789abcdef01234567 staged"),
    ).toBe(lineShape("blob fedcba9876543210fedcba9876543210fedcba98 staged"));
  });

  it("keeps the identifying parts of a line apart on purpose", () => {
    // Normalization is conservative: it collapses volatile *values*, never
    // names. Two different tests therefore never share a shape, even though
    // the SPEC's illustrative example collapses them.
    expect(lineShape("[12:01:04] test alpha passed")).not.toBe(
      lineShape("[12:01:05] test beta passed"),
    );
    // Short durations are values that may matter (a slow test is a finding).
    expect(lineShape("test alpha passed in 31ms")).not.toBe(
      lineShape("test alpha passed in 900ms"),
    );
  });

  it("strips ANSI escapes so colorized and plain output share a shape", () => {
    expect(lineShape("\u001b[32mPASS\u001b[0m suite one")).toBe(
      lineShape("PASS suite one"),
    );
  });

  it("keeps values that may be the evidence the next decision needs", () => {
    // Line and column positions, HTTP codes, exit codes, short counters.
    expect(lineShape("src/app.ts:123:45 — unreachable")).not.toBe(
      lineShape("src/app.ts:888:9 — unreachable"),
    );
    expect(lineShape("GET /health 200")).not.toBe(lineShape("GET /health 404"));
    expect(lineShape("process exited with code 1")).not.toBe(
      lineShape("process exited with code 0"),
    );
    // Version numbers, including ones with a long component.
    expect(lineShape("node v20.11.1")).not.toBe(lineShape("node v22.19.0"));
    expect(lineShape("upgraded to 1.2.2045")).not.toBe(
      lineShape("upgraded to 1.2.2046"),
    );
    // Paths and identifiers.
    expect(lineShape("wrote out/report-1.json")).not.toBe(
      lineShape("wrote out/report-2.json"),
    );
  });

  it("keeps short hashes intact because they are cited later", () => {
    expect(lineShape("commit 5b54e83")).not.toBe(lineShape("commit 4d2f9a1"));
  });

  it("never lets a placeholder delimiter reach the shape", () => {
    // Any control character at all would mean a delimiter survived restoration.
    const controlCharacters = new RegExp(String.raw`[\u0000-\u001f]`, "u");
    for (const line of [
      "at Object.<anonymous> (/app/src/index.ts:12:7)",
      "GET /v1/items 200",
      "process exited with code 1",
      "\u001b[31mFAIL\u001b[0m suite",
    ]) {
      expect(lineShape(line)).not.toMatch(controlCharacters);
    }
  });
});

describe("analyzeText", () => {
  const options = { minRunLines: 3, keepHeadLines: 1, keepTailLines: 1 };

  it("groups only adjacent same-shape lines", () => {
    const text = [
      "head",
      "progress 1%",
      "progress 2%",
      "progress 3%",
      "progress 4%",
      "tail",
    ].join("\n");
    const analysis = analyzeText(text, options);
    expect(analysis.runs).toHaveLength(1);
    expect(analysis.runs[0]!.start).toBe(1);
    expect(analysis.runs[0]!.end).toBe(5);
    expect(analysis.runs[0]!.count).toBe(4);
  });

  it("never merges identical lines that are not adjacent", () => {
    const text = ["progress 1%", "result: ok", "progress 2%", "done"].join(
      "\n",
    );
    const analysis = analyzeText(text, {
      minRunLines: 2,
      keepHeadLines: 0,
      keepTailLines: 0,
    });
    expect(analysis.runs).toHaveLength(0);
  });

  it("splits a run at a pinned line and keeps the outcome line", () => {
    const text = [
      "downloading a 1%",
      "downloading a 2%",
      "downloading a 3%",
      "ERROR: connection reset by peer",
      "downloading a 4%",
      "downloading a 5%",
      "downloading a 6%",
    ].join("\n");
    const analysis = analyzeText(text, {
      minRunLines: 3,
      keepHeadLines: 0,
      keepTailLines: 0,
    });
    expect(analysis.pinned.has(3)).toBe(true);
    expect(analysis.runs.map((run) => [run.start, run.end])).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it("respects the head and tail pins", () => {
    const lines = Array.from(
      { length: 10 },
      (_, index) => `item ${index} done`,
    );
    const analysis = analyzeText(lines.join("\n"), {
      minRunLines: 3,
      keepHeadLines: 3,
      keepTailLines: 3,
    });
    for (const index of [0, 1, 2, 7, 8, 9]) {
      expect(analysis.pinned.has(index), `line ${index}`).toBe(true);
    }
    for (const index of [3, 4, 5, 6]) {
      expect(analysis.pinned.has(index), `line ${index}`).toBe(false);
    }
  });

  it("reports the repetition ratio over non-blank lines", () => {
    const text = ["progress 1%", "progress 2%", "progress 3%", "", "done"].join(
      "\n",
    );
    const analysis = analyzeText(text, {
      minRunLines: 3,
      keepHeadLines: 0,
      keepTailLines: 0,
    });
    expect(analysis.repetitionRatio).toBeCloseTo(3 / 4, 5);
  });
});

describe("pins", () => {
  it("recognizes conclusions, failures and diagnostics", () => {
    for (const line of [
      "80 passed, 1 failed",
      "ERROR: cannot find module",
      "warning: unused variable",
      "  at Object.<anonymous> (/app/x.js:10:15)",
      "Traceback (most recent call last):",
      "error TS2345: argument of type",
      "process exited with code 1",
      "added 42 packages in 3s",
      "+++ b/src/app.ts",
    ]) {
      expect(matchesImportant(line), line).toBe(true);
    }
  });

  it("leaves ordinary progress lines unpinned", () => {
    for (const line of [
      "downloading a 12%",
      "fetching metadata",
      "compiling module 4 of 90",
    ]) {
      expect(matchesImportant(line), line).toBe(false);
    }
  });

  it("pins blank lines so output segmentation survives", () => {
    const pinned = pinnedLines(["a", "", "b"], 0, 0);
    expect(pinned.has(1)).toBe(true);
  });
});

describe("splitLines", () => {
  it("treats a trailing newline as a terminator, not an empty line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });
});
