import { describe, expect, it } from "vitest";
import { extractFeatures, formatFeatures } from "../../src/planner/features.js";
import type { ToolResultCandidate } from "../../src/planner/collect.js";
import type { ToolCallInfo } from "../../src/dsh/surface.js";
import { SessionSeq } from "@deepseek-ai/dsh-session";

function call(
  seq: number,
  callId: string,
  args: string,
): [string, ToolCallInfo] {
  return [
    callId,
    {
      seq: SessionSeq(seq),
      callId,
      name: "read",
      arguments: args,
      turn: 1,
      step: 1,
    },
  ];
}

function candidate(
  callId: string,
  seq: number,
  text: string,
  preview?: string,
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
    agePositions: 3,
    toolArgumentsPreview: preview,
  };
}

describe("extractFeatures", () => {
  it("marks an older read of the same path superseded", () => {
    const older = candidate(
      "c1",
      10,
      "old contents",
      JSON.stringify({ path: "src/a.ts" }),
    );
    const newer = candidate(
      "c2",
      30,
      "new contents",
      JSON.stringify({ path: "src/a.ts" }),
    );
    const callIndex = new Map([call(9, "c1", "{}"), call(29, "c2", "{}")]);
    const features = extractFeatures([older, newer], callIndex);
    expect(features.get("c1")?.superseded).toBe(true);
    expect(features.get("c2")?.superseded).toBe(false);
  });

  it("marks equivalent repeated searches duplicateLike", () => {
    const args = JSON.stringify({ query: "refresh token rotation" });
    const older = candidate("c1", 10, "results one", args);
    const newer = candidate("c2", 40, "results two", args);
    const callIndex = new Map([call(9, "c1", args), call(39, "c2", args)]);
    const features = extractFeatures([older, newer], callIndex);
    expect(features.get("c1")?.duplicateLike).toBe(true);
  });

  it("classifies rerunnability from tool and command hints", () => {
    const callIndex = new Map<string, ToolCallInfo>();
    const grep = candidate("g1", 5, "matches");
    grep.toolName = "grep";
    const web = candidate("w1", 6, "body");
    web.toolName = "web_fetch";
    const test = candidate(
      "t1",
      7,
      "output",
      JSON.stringify({ command: "pnpm test auth" }),
    );
    test.toolName = "shell";
    const features = extractFeatures([grep, web, test], callIndex);
    expect(features.get("g1")?.rerunnable).toBe("cheap");
    expect(features.get("w1")?.rerunnable).toBe("expensive");
    expect(features.get("t1")?.rerunnable).toBe("cheap");
  });

  it("flags likely exact evidence", () => {
    const callIndex = new Map<string, ToolCallInfo>();
    const stack = candidate("s1", 5, "Error: boom\n    at run (/x/y.ts:12:5)");
    const plain = candidate("s2", 6, "everything looks fine here");
    const features = extractFeatures([stack, plain], callIndex);
    expect(features.get("s1")?.containsLikelyExactEvidence).toBe(true);
    expect(features.get("s2")?.containsLikelyExactEvidence).toBe(false);
  });

  it("renders a one-line feature summary for the state", () => {
    const callIndex = new Map<string, ToolCallInfo>();
    const older = candidate(
      "c1",
      10,
      "old",
      JSON.stringify({ path: "src/a.ts" }),
    );
    const newer = candidate(
      "c2",
      30,
      "new",
      JSON.stringify({ path: "src/a.ts" }),
    );
    const features = extractFeatures([older, newer], callIndex);
    expect(formatFeatures(features.get("c1"))).toContain("superseded:true");
    expect(formatFeatures(undefined)).toBe("none");
  });
});
