import { describe, expect, it } from "vitest";
import {
  codePointLength,
  renderStub,
  renderTruncated,
} from "../../src/mutation/render.js";
import { decideAction } from "../../src/planner/policy.js";
import {
  estimateSavings,
  meetsSavingsGate,
} from "../../src/planner/savings.js";
import { resolveJevCompactionConfig } from "../../src/config.js";
import type { ToolResultCandidate } from "../../src/planner/collect.js";
import { SessionSeq } from "@deepseek-ai/dsh-session";

const CONFIG = resolveJevCompactionConfig({});

function candidate(text: string): ToolResultCandidate {
  return {
    surfaceSeq: SessionSeq(12),
    callId: "call-1",
    toolName: "read",
    turn: 1,
    step: 1,
    originalText: text,
    originalChars: codePointLength(text),
    isError: false,
    agePositions: 9,
  };
}

describe("replacement renderers", () => {
  it("renders a neutral stub that never claims relevance was proven", () => {
    const stub = renderStub(
      candidate("x".repeat(500)),
      "low semantic retention score",
    );
    expect(stub).toContain("[dsh-jev-compaction]");
    expect(stub).toContain("pruned from active model context");
    expect(stub).toContain("tool=read");
    expect(stub).toContain("originalChars=500");
    expect(stub).toContain("session log");
    expect(stub).not.toMatch(/irrelevant|proved|garbage/i);
  });

  it("truncates with a head, a marker, and a tail", () => {
    const original = `${"a".repeat(384)}${"b".repeat(1000)}${"c".repeat(128)}`;
    const rendered = renderTruncated(original, 384, 128);
    expect(rendered.startsWith("a".repeat(384))).toBe(true);
    expect(rendered.endsWith("c".repeat(128))).toBe(true);
    expect(rendered).toContain("pruned 1,000 historical characters");
    expect(codePointLength(rendered)).toBeLessThan(codePointLength(original));
  });

  it("keeps the original when nothing would be removed", () => {
    const original = "short output";
    expect(renderTruncated(original, 384, 128)).toBe(original);
  });

  it("slices by code point without splitting surrogate pairs", () => {
    const original = `${"😀".repeat(10)}${"y".repeat(200)}`;
    const rendered = renderTruncated(original, 8, 4);
    expect(rendered).toContain("😀".repeat(4));
    expect(rendered).not.toContain("\uFFFD");
  });
});

describe("decision policy", () => {
  it("keeps full at or above fullThreshold", () => {
    expect(decideAction({ needContents: 0.7 }, CONFIG)).toBe("KEEP_FULL");
    expect(decideAction({ needContents: 0.95 }, CONFIG)).toBe("KEEP_FULL");
  });

  it("truncates between thresholds", () => {
    expect(decideAction({ needContents: 0.5 }, CONFIG)).toBe("KEEP_TRUNCATED");
  });

  it("stubs below truncateThreshold", () => {
    expect(decideAction({ needContents: 0.1 }, CONFIG)).toBe("KEEP_STUB");
  });

  it("downgrades to a stub when verbatim is clearly unwanted", () => {
    expect(decideAction({ needContents: 0.5, needVerbatim: 0.2 }, CONFIG)).toBe(
      "KEEP_STUB",
    );
    expect(decideAction({ needContents: 0.5, needVerbatim: 0.5 }, CONFIG)).toBe(
      "KEEP_TRUNCATED",
    );
  });
});

describe("savings gate", () => {
  const config = resolveJevCompactionConfig({
    pruning: { minSavingsChars: 100, minSavingsRatio: 0.05 },
  });

  it("passes when either threshold is met", () => {
    const big = estimateSavings([
      { action: "KEEP_STUB", originalChars: 1000, replacementChars: 900 },
    ]);
    const relative = estimateSavings([
      { action: "KEEP_STUB", originalChars: 1000, replacementChars: 100 },
    ]);
    expect(big.charsSaved).toBe(100);
    expect(meetsSavingsGate(big, config)).toBe(true);
    expect(meetsSavingsGate(relative, config)).toBe(true);
  });

  it("fails when both thresholds are missed", () => {
    const small = estimateSavings([
      { action: "KEEP_STUB", originalChars: 100, replacementChars: 99 },
    ]);
    expect(meetsSavingsGate(small, config)).toBe(false);
  });

  it("ignores KEEP_FULL items", () => {
    const mixed = estimateSavings([
      { action: "KEEP_FULL", originalChars: 9000, replacementChars: 9000 },
      { action: "KEEP_STUB", originalChars: 200, replacementChars: 60 },
    ]);
    expect(mixed.charsSaved).toBe(140);
    expect(meetsSavingsGate(mixed, config)).toBe(true);
  });
});
