/**
 * Content layout, retention policy, reconstruction and the per-turn budget —
 * the small deterministic pieces the pipeline is built from.
 */

import { describe, expect, it } from "vitest";

import { resolveJevCompactionConfig } from "../../src/config.js";
import {
  TurnShapeBudget,
  latestTurn,
} from "../../src/result-shaping/budget.js";
import { decideRun } from "../../src/result-shaping/policy.js";
import {
  archiveMarker,
  collapseMarker,
  isShapedText,
  readArchiveRef,
  reconstruct,
  runSavings,
} from "../../src/result-shaping/reconstruct.js";
import {
  extractText,
  hasText,
  replaceText,
} from "../../src/result-shaping/text.js";

describe("extractText / replaceText", () => {
  it("reads a single text block whatever surrounds it", () => {
    const image = { type: "image", mime: "image/png" };
    const content = [image, { type: "text", text: "body" }];
    const extracted = extractText(content);
    expect(extracted).toEqual({ text: "body", layout: "single" });
    const replaced = replaceText(content, extracted!, "shaped");
    expect(replaced).toEqual([image, { type: "text", text: "shaped" }]);
  });

  it("collapses a text-only content array into one block in place", () => {
    const content = [
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ];
    const extracted = extractText(content);
    expect(extracted).toEqual({ text: "one\ntwo", layout: "uniform" });
    expect(replaceText(content, extracted!, "shaped")).toEqual([
      { type: "text", text: "shaped" },
    ]);
  });

  it("refuses an ambiguous mix rather than guessing a block structure", () => {
    const content = [
      { type: "text", text: "one" },
      { type: "image", mime: "image/png" } as { type: string },
      { type: "text", text: "two" },
    ];
    expect(extractText(content)).toBeUndefined();
  });

  it("refuses content without text at all", () => {
    const image: { type: string; mime: string }[] = [
      { type: "image", mime: "image/png" },
    ];
    expect(extractText(image)).toBeUndefined();
    expect(hasText(image)).toBe(false);
  });

  it("never mutates the original content array", () => {
    const content = [{ type: "text", text: "one" }];
    replaceText(content, extractText(content)!, "shaped");
    expect(content[0]!.text).toBe("one");
  });
});

describe("decideRun", () => {
  it("collapses only on a decisive pair of answers", () => {
    expect(decideRun({ routine: 0.95, needed: 0.02 }, 0.6)).toEqual({
      decision: "collapse",
      reason: "routine",
    });
  });

  it("keeps a block whose answers are not decisively apart", () => {
    // Both above the confidence bar: the model is not saying either thing.
    expect(decideRun({ routine: 0.9, needed: 0.9 }, 0.6).decision).toBe("keep");
    expect(decideRun({ routine: 0.61, needed: 0.39 }, 0.6).decision).toBe(
      "collapse",
    );
    expect(decideRun({ routine: 0.6, needed: 0.4 }, 0.6).decision).toBe(
      "collapse",
    );
  });

  it("keeps a block the model marks as needed", () => {
    expect(decideRun({ routine: 0.9, needed: 0.8 }, 0.6)).toEqual({
      decision: "keep",
      reason: "needed",
    });
  });

  it("keeps on a mid-range probability, a missing answer or an invalid one", () => {
    expect(decideRun({ routine: 0.5, needed: 0.5 }, 0.6).reason).toBe(
      "low-confidence",
    );
    expect(decideRun({ routine: 0.9 }, 0.6).reason).toBe("invalid-answer");
    expect(decideRun({}, 0.6).reason).toBe("missing-answer");
    expect(decideRun({ routine: 2, needed: 0 }, 0.6).reason).toBe(
      "invalid-answer",
    );
  });

  it("never treats a raw probability as permission", () => {
    // 0.55 routine would pass a naive "> 0.5" test; the confidence bar holds.
    expect(decideRun({ routine: 0.55, needed: 0.1 }, 0.6).decision).toBe(
      "keep",
    );
  });
});

describe("reconstruction markers", () => {
  it("states what happened without claiming the output was irrelevant", () => {
    expect(collapseMarker(97)).toBe(
      "[dsh-jev-compaction: collapsed 97 repetitive lines]",
    );
    expect(collapseMarker(1200)).toBe(
      "[dsh-jev-compaction: collapsed 1,200 repetitive lines]",
    );
    expect(collapseMarker(3)).not.toMatch(/irrelevant|unused|safe/i);
  });

  it("carries an opaque archive reference, never a filesystem path", () => {
    const marker = archiveMarker("sha256:0123456789ab");
    expect(marker).toBe(
      "[dsh-jev-compaction: original archived as sha256:0123456789ab]",
    );
    expect(marker).not.toMatch(/[\\/]|\.dsh|:\/\/|C:/u);
    expect(marker).not.toMatch(/[\\/]|\.dsh|C:/u);
  });

  it("round-trips through detection", () => {
    const text = `log\n${collapseMarker(5)}\n${archiveMarker("sha256:abc")}`;
    expect(isShapedText(text)).toBe(true);
    expect(readArchiveRef(text)).toBe("sha256:abc");
    expect(readArchiveRef("plain output")).toBeUndefined();
    expect(isShapedText("plain output")).toBe(false);
  });

  it("rebuilds in place and leaves untouched lines alone", () => {
    const lines = ["a", "b1", "b2", "b3", "c"];
    expect(
      reconstruct({
        lines,
        collapsed: [{ start: 1, end: 4, count: 3, shape: "b", sample: "b1" }],
      }),
    ).toBe(`a\n${collapseMarker(3)}\nc`);
  });

  it("appends the archive marker after a blank separator", () => {
    const text = reconstruct({
      lines: ["a", "b", "c"],
      collapsed: [{ start: 1, end: 3, count: 2, shape: "x", sample: "b" }],
      archiveRef: "sha256:0123456789ab",
    });
    expect(text).toBe(
      `a\n${collapseMarker(2)}\n\n${archiveMarker("sha256:0123456789ab")}`,
    );
  });

  it("prices a collapse including the marker's own cost", () => {
    const lines = ["x".repeat(100), "x".repeat(100), "x".repeat(100)];
    const savings = runSavings(lines, {
      start: 0,
      end: 3,
      count: 3,
      shape: "x",
      sample: "x",
    });
    expect(savings).toBeGreaterThan(250);
    expect(savings).toBeLessThan(303);
  });
});

describe("TurnShapeBudget", () => {
  const config = resolveJevCompactionConfig({
    resultShaping: { maxPerTurn: 2, maxInputCharsPerTurn: 50000 },
  });

  const session = {
    snapshotEvents: () => [{ data: { turn: 1 } }, { data: { turn: 7 } }],
  } as never;

  it("reads the newest turn from the end of the log", () => {
    expect(latestTurn(session)).toBe(7);
    expect(latestTurn({ snapshotEvents: () => [] } as never)).toBeUndefined();
  });

  it("caps the number of shapes per turn", () => {
    const budget = new TurnShapeBudget();
    expect(budget.tryConsume("s1", 3, 100, config)).toBe(true);
    expect(budget.tryConsume("s1", 3, 100, config)).toBe(true);
    expect(budget.tryConsume("s1", 3, 100, config)).toBe(false);
  });

  it("caps the input characters per turn", () => {
    const budget = new TurnShapeBudget();
    expect(budget.tryConsume("s1", 3, 30000, config)).toBe(true);
    expect(budget.tryConsume("s1", 3, 30000, config)).toBe(false);
    // A new turn starts from zero.
    expect(budget.tryConsume("s1", 4, 30000, config)).toBe(true);
  });

  it("keys the budget per session so parallel calls cannot share it", () => {
    const budget = new TurnShapeBudget();
    expect(budget.tryConsume("s1", 1, 0, config)).toBe(true);
    expect(budget.tryConsume("s1", 1, 0, config)).toBe(true);
    expect(budget.tryConsume("s2", 1, 0, config)).toBe(true);
    expect(budget.tryConsume("s1", 1, 0, config)).toBe(false);
  });

  it("stays bounded across many sessions", () => {
    const budget = new TurnShapeBudget();
    for (let index = 0; index < 500; index += 1) {
      budget.tryConsume(`session-${index}`, 1, 10, config);
    }
    expect(
      Object.keys((budget as unknown as { usage: Map<string, unknown> }).usage)
        .length,
    ).toBeLessThanOrEqual(64);
  });

  it("refuses everything when the per-turn cap is zero", () => {
    const off = resolveJevCompactionConfig({
      resultShaping: { maxPerTurn: 0 },
    });
    expect(new TurnShapeBudget().tryConsume("s", 1, 0, off)).toBe(false);
  });
});

describe("archive deadline", () => {
  it("keeps the original when the archive store never settles", async () => {
    const { ImmediateResultShaper } =
      await import("../../src/result-shaping/shaper.js");
    const { resolveJevCompactionConfig, DEFAULT_SHAPE_TOOLS } =
      await import("../../src/config.js");
    const { ShapingMetrics } =
      await import("../../src/result-shaping/metrics.js");
    const config = resolveJevCompactionConfig({
      resultShaping: {
        enabled: true,
        includeTools: [...DEFAULT_SHAPE_TOOLS],
        requestTimeoutMs: 1000,
        thresholdChars: 1000,
      },
    });
    const skips: string[] = [];
    const shaper = new ImmediateResultShaper({
      readConfig: () => config,
      // Decisive answers, so the pipeline reaches the archive step.
      backend: {
        score: async (_state, questions) => {
          const answers = new Map<string, number>();
          for (const question of questions) {
            answers.set(
              question.name,
              question.name.startsWith("routine_") ? 0.99 : 0.01,
            );
          }
          return answers;
        },
      },
      // A store that hangs: the tool path must not wait for it.
      archive: {
        put: () => new Promise<string>(() => undefined),
        get: async () => null,
      },
      metrics: new ShapingMetrics(),
      onSkip: (reason) => {
        skips.push(reason);
      },
      onShaped: () => undefined,
    });

    const log = [
      "installing dependencies",
      ...Array.from(
        { length: 300 },
        (_, index) => `progress ${index + 1}% of dependency graph`,
      ),
      "added 42 packages in 3s",
    ].join("\n");
    const outcome = await shaper.maybeShape({
      callId: "call-1",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: log }],
      goal: "goal",
    });
    expect(outcome).toBeUndefined();
    expect(skips).toContain("archive-error");
  }, 10_000);
});
