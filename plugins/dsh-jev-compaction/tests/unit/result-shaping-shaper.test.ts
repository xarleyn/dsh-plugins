/**
 * The shaping pipeline: eligibility, the classifier round trip, the retention
 * policy, reconstruction and the savings gate (result-shaping SPEC §53).
 *
 * Every case here is a "keep the original" case except the ones that are
 * explicitly supposed to collapse something: the failure modes are the
 * feature.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHAPE_TOOLS,
  resolveJevCompactionConfig,
} from "../../src/config.js";
import type { ResolvedJevCompactionConfig } from "../../src/config.js";
import type {
  ArchivedToolResult,
  OriginalResultArchive,
} from "../../src/archive/types.js";
import { ShapingMetrics } from "../../src/result-shaping/metrics.js";
import { ImmediateResultShaper } from "../../src/result-shaping/shaper.js";
import type { ShapeSkipReason } from "../../src/result-shaping/metrics.js";
import type {
  JevAnswers,
  JevQuestion,
  JevState,
  SystemOneBackend,
} from "../../src/jev/types.js";

/** Backend answering by question kind, with per-test control. */
class ScriptedBackend implements SystemOneBackend {
  public calls = 0;
  public lastQuestions: readonly JevQuestion[] = [];

  constructor(
    private readonly routine: number = 0.95,
    private readonly needed: number = 0.05,
  ) {}

  async score(
    _state: JevState,
    questions: readonly JevQuestion[],
  ): Promise<JevAnswers> {
    this.calls += 1;
    this.lastQuestions = questions;
    const answers: JevAnswers = new Map();
    for (const question of questions) {
      if (question.name.startsWith("routine_")) {
        answers.set(question.name, this.routine);
      } else {
        answers.set(question.name, this.needed);
      }
    }
    return answers;
  }
}

class ThrowingBackend implements SystemOneBackend {
  async score(): Promise<JevAnswers> {
    throw new Error("jev unavailable");
  }
}

class TimeoutBackend implements SystemOneBackend {
  async score(
    _state: JevState,
    _questions: readonly JevQuestion[],
    signal?: AbortSignal,
  ): Promise<JevAnswers> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal?.aborted === true) throw new Error("aborted");
    throw new Error("jev request timed out");
  }
}

/** Archive that records what it was given, or fails on demand. */
class RecordingArchive implements OriginalResultArchive {
  public readonly entries: ArchivedToolResult[] = [];

  constructor(private readonly fail = false) {}

  async put(entry: ArchivedToolResult): Promise<string> {
    if (this.fail) throw new Error("disk full");
    this.entries.push(entry);
    return entry.contentHash;
  }

  async get(): Promise<ArchivedToolResult | null> {
    return null;
  }
}

/** Two long repetitive runs plus a head line and two pinned conclusions. */
const PROGRESS_LINES = Array.from(
  { length: 300 },
  (_, index) => `progress ${index + 1}% of dependency graph`,
);
const FETCH_LINES = Array.from(
  { length: 100 },
  (_, index) => `fetching metadata for pkg-${index}`,
);
const PROGRESS_LOG = [
  "installing dependencies",
  ...PROGRESS_LINES,
  ...FETCH_LINES,
  "added 42 packages in 3s",
  "80 passed, 1 failed",
].join("\n");

function textContent(text: string): { type: string; text: string }[] {
  return [{ type: "text", text }];
}

interface Harness {
  readonly shaper: ImmediateResultShaper;
  /** How many classifier requests the pipeline actually issued. */
  readonly calls: () => number;
  readonly archive: RecordingArchive;
  readonly metrics: ShapingMetrics;
  readonly skips: ShapeSkipReason[];
  readonly shaped: Record<string, unknown>[];
  setConfig(patch: Parameters<typeof resolveJevCompactionConfig>[0]): void;
}

function harness(
  backend: ScriptedBackend | ThrowingBackend | TimeoutBackend,
  raw: Parameters<typeof resolveJevCompactionConfig>[0] = {},
  archive: RecordingArchive = new RecordingArchive(),
): Harness {
  let resolved: ResolvedJevCompactionConfig;
  const setConfig = (
    patch: Parameters<typeof resolveJevCompactionConfig>[0],
  ) => {
    resolved = resolveJevCompactionConfig(patch);
  };
  setConfig({
    ...raw,
    resultShaping: {
      enabled: true,
      includeTools: [...DEFAULT_SHAPE_TOOLS],
      ...raw.resultShaping,
    },
  });
  let calls = 0;
  const counted: SystemOneBackend = {
    score: (state, questions, signal) => {
      calls += 1;
      return backend.score(state, questions, signal);
    },
  };
  const metrics = new ShapingMetrics();
  const skips: ShapeSkipReason[] = [];
  const shaped: Record<string, unknown>[] = [];
  const shaper = new ImmediateResultShaper({
    readConfig: () => resolved,
    backend: counted,
    archive,
    metrics,
    onSkip: (reason) => {
      skips.push(reason);
    },
    onShaped: (details) => {
      shaped.push(details);
    },
  });
  return {
    shaper,
    calls: () => calls,
    archive,
    metrics,
    skips,
    shaped,
    setConfig,
  };
}

function shape(
  harness: Harness,
  overrides: Partial<{
    toolName: string;
    content: { type: string; text: string }[];
    isError: boolean;
    text: string;
  }> = {},
) {
  return harness.shaper.maybeShape({
    callId: "call-1",
    toolName: overrides.toolName ?? "bash",
    isError: overrides.isError ?? false,
    content: overrides.content ?? textContent(overrides.text ?? PROGRESS_LOG),
    goal: "run the test suite",
  });
}

describe("immediate result shaping", () => {
  it("collapses a routine run and keeps the pinned outcome lines", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test);

    expect(outcome).toBeDefined();
    const shaped = outcome!.content[0]!.text as string;
    // The collapsed runs are gone, replaced by neutral markers.
    expect(shaped).toMatch(
      /\[dsh-jev-compaction: collapsed [\d,]+ repetitive lines\]/u,
    );
    expect(outcome!.collapsedRuns).toBeGreaterThanOrEqual(2);
    expect(outcome!.collapsedLines).toBeGreaterThan(300);
    expect(shaped).not.toContain("progress 60% of dependency graph");
    expect(shaped).not.toContain("fetching metadata for pkg-40");
    // The conclusion lines survive verbatim.
    expect(shaped).toContain("added 42 packages in 3s");
    expect(shaped).toContain("80 passed, 1 failed");
    expect(shaped).toContain("installing dependencies");
    expect(outcome!.savedChars).toBeGreaterThan(0);
    expect(test.shaped).toHaveLength(1);
  });

  it("leaves a small result untouched", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test, { text: "hello world\nsecond line" });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("too-small");
    expect(test.calls()).toBe(0);
  });

  it("leaves a tool outside the allowlist untouched", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test, { toolName: "read" });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("tool-not-allowed");
    expect(test.calls()).toBe(0);
  });

  it("honours the deny list over the allow list", async () => {
    const test = harness(new ScriptedBackend(), {
      resultShaping: { excludeTools: ["bash"] },
    });
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("tool-not-allowed");
  });

  it("leaves a failed result untouched while preserveErrors is on", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test, { isError: true });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("error-result");
  });

  it("shapes a failed result when the operator turns the guard off", async () => {
    const test = harness(new ScriptedBackend(), {
      resultShaping: { preserveErrors: false },
    });
    const outcome = await shape(test, { isError: true });
    expect(outcome).toBeDefined();
  });

  it("leaves content whose text cannot be rebuilt untouched", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await test.shaper.maybeShape({
      callId: "call-1",
      toolName: "bash",
      isError: false,
      goal: "goal",
      content: [
        { type: "text", text: PROGRESS_LOG },
        { type: "image", mime: "image/png", data: "Zm9v" } as never,
        { type: "text", text: "trailing note" },
      ],
    });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("unsupported-content");
  });

  it("leaves a result that was already shaped untouched", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test, {
      text: `${PROGRESS_LOG}\n[dsh-jev-compaction: collapsed 120 repetitive lines]`,
    });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("already-shaped");
  });

  it("leaves a result another layer already bounded untouched", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test, {
      text: `${PROGRESS_LOG}\n(Full formatted result stored at: dsh-spill://abc. Retrieve it with the spill tool.)`,
    });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("already-spilled");
  });

  it("keeps everything when the classifier is not confident", async () => {
    const test = harness(new ScriptedBackend(0.62, 0.42));
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("low-confidence");
    expect(test.metrics.count("resultShaping.keptOriginal")).toBe(1);
  });

  it("keeps a run the classifier marks as needed", async () => {
    const test = harness(new ScriptedBackend(0.3, 0.95));
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("not-repetitive");
  });

  it("keeps the original when the classifier request fails", async () => {
    const test = harness(new ThrowingBackend());
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("jev-error");
    expect(test.metrics.count("resultShaping.errors")).toBe(1);
  });

  it("keeps the original when the classifier times out", async () => {
    const test = harness(new TimeoutBackend(), {
      resultShaping: { requestTimeoutMs: 500 },
    });
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("jev-error");
    expect(test.metrics.count("resultShaping.timeouts")).toBe(1);
  });

  it("keeps the original when the saving is below the gate", async () => {
    // A real collapse of three lines, but far short of the savings gate.
    const test = harness(new ScriptedBackend(), {
      resultShaping: { keepHeadLines: 1, keepTailLines: 1 },
    });
    const text = [
      "header",
      ...Array.from({ length: 3 }, (_, index) => `progress ${index + 1}%`),
      "footer",
      "x".repeat(20000),
    ].join("\n");
    const outcome = await shape(test, { text });
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("low-savings");
    expect(test.calls()).toBe(1);
  });

  it("preserves the order of the surviving lines", async () => {
    const test = harness(new ScriptedBackend());
    const outcome = await shape(test);
    const shaped = outcome!.content[0]!.text as string;
    const original = PROGRESS_LOG.split("\n");
    const survived = shaped
      .split("\n")
      .filter(
        (line) => line.length > 0 && !line.includes("[dsh-jev-compaction:"),
      );

    // What survived is a subsequence of the original: reconstruction drops
    // whole runs in place and never reorders or reattaches anything.
    let cursor = 0;
    for (const line of survived) {
      const found = original.indexOf(line, cursor);
      expect(found, `line out of order: ${line}`).toBeGreaterThanOrEqual(
        cursor,
      );
      cursor = found + 1;
    }
    // The collapse is real: most of the original is gone.
    expect(survived.length).toBeLessThan(original.length / 2);
    // Both ends of the output survive, which is what the pins are for.
    expect(survived[0]).toBe("installing dependencies");
    expect(survived[survived.length - 2]).toBe("added 42 packages in 3s");
    expect(survived[survived.length - 1]).toBe("80 passed, 1 failed");
  });
});

describe("immediate shaping and the archive", () => {
  it("archives the original and marks the shaped text with its reference", async () => {
    const archive = new RecordingArchive();
    const test = harness(new ScriptedBackend(), {}, archive);
    const outcome = await shape(test);
    expect(outcome!.archiveRef).toMatch(/^sha256:[0-9a-f]{12}$/u);
    expect(archive.entries).toHaveLength(1);
    expect(archive.entries[0]!.toolName).toBe("bash");
    expect(archive.entries[0]!.content[0]).toEqual({
      type: "text",
      text: PROGRESS_LOG,
    });
    expect(outcome!.content[0]!.text as string).toContain(
      `[dsh-jev-compaction: original archived as ${outcome!.archiveRef}]`,
    );
  });

  it("keeps the original when archiving fails and the policy says so", async () => {
    const test = harness(new ScriptedBackend(), {}, new RecordingArchive(true));
    const outcome = await shape(test);
    expect(outcome).toBeUndefined();
    expect(test.skips).toContain("archive-error");
    expect(test.metrics.count("resultShaping.archiveFailures")).toBe(1);
  });

  it("shapes without a reference when the operator allows it", async () => {
    const test = harness(
      new ScriptedBackend(),
      { archive: { onFailure: "shape-anyway" } },
      new RecordingArchive(true),
    );
    const outcome = await shape(test);
    expect(outcome).toBeDefined();
    expect(outcome!.archiveRef).toBeUndefined();
    expect(outcome!.content[0]!.text as string).not.toContain("archived as");
  });

  it("skips the archive entirely when it is disabled", async () => {
    const archive = new RecordingArchive();
    const test = harness(
      new ScriptedBackend(),
      { archive: { enabled: false } },
      archive,
    );
    const outcome = await shape(test);
    expect(outcome).toBeDefined();
    expect(outcome!.archiveRef).toBeUndefined();
    expect(archive.entries).toHaveLength(0);
    expect(test.metrics.count("resultShaping.archiveWrites")).toBe(0);
  });
});

describe("immediate shaping metrics", () => {
  it("counts seen, eligible, requests and savings separately from pruning", async () => {
    const test = harness(new ScriptedBackend());
    await shape(test);
    const snapshot = test.metrics.snapshot();
    expect(snapshot["resultShaping.seen"]).toBe(1);
    expect(snapshot["resultShaping.eligible"]).toBe(1);
    expect(snapshot["resultShaping.requests"]).toBe(1);
    expect(snapshot["resultShaping.shaped"]).toBe(1);
    expect(snapshot["resultShaping.originalChars"]).toBe(PROGRESS_LOG.length);
    expect(snapshot["resultShaping.savedChars"]).toBeGreaterThan(0);
    expect(snapshot["resultShaping.jevInputEstimate"]).toBeGreaterThan(0);
    expect(snapshot["resultShaping.collapsedLines"]).toBeGreaterThan(0);
    // Historical-compaction counters are a different namespace entirely.
    expect(
      Object.keys(snapshot).every((name) => name.startsWith("resultShaping.")),
    ).toBe(true);
  });
});
