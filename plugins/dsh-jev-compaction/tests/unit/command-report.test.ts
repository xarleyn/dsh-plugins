/**
 * The `/jev-compact --dry-run` audit output (result-shaping SPEC §46).
 *
 * The two layers report separately: one combined "saved" number would hide
 * which of them did the work.
 */

import { describe, expect, it } from "vitest";

import { registerJevCompactCommand } from "../../src/commands/jev-compact.js";
import type { ResultShapingSubsystem } from "../../src/result-shaping/index.js";
import type { JevCompactionService, JevRunReport } from "../../src/service.js";

type Stats = ReturnType<ResultShapingSubsystem["stats"]>;

const EMPTY: Stats = { counters: {}, skipReasons: {} };

const REPORT: JevRunReport = {
  mode: "dry-run",
  sessionId: "session-1",
  candidates: 2,
  keptFull: 1,
  truncated: 1,
  stubbed: 0,
  charsBefore: 1000,
  charsAfter: 400,
  tokensBefore: 100,
  tokensAfter: 60,
  jevRequests: 1,
  totalLatencyMs: 12,
  applied: [],
  plan: {
    surfaceSnapshot: { replaceGeneration: 0, nodes: [] },
    items: [],
    mutations: [],
    savings: { charsSaved: 600, ratio: 0.6 },
  },
};

/** Register the command against a stub service and return its handler. */
function capture(stats: Stats) {
  let handler:
    | ((invocation: unknown) => Promise<{ kind: string; text?: string }>)
    | undefined;
  const registry = {
    register(definition: { handler: typeof handler }) {
      handler = definition.handler;
      return () => {};
    },
  };
  registerJevCompactCommand(
    registry as never,
    {
      runManualDry: async () => REPORT,
      shaping: { stats: () => stats },
    } as unknown as JevCompactionService,
  );
  return async (rawInput: string): Promise<string> => {
    const result = await handler!({
      rawInput,
      agent: { id: "agent-1", session: {} },
      signal: new AbortController().signal,
    });
    return result.text ?? "";
  };
}

describe("/jev-compact dry-run report", () => {
  it("omits the shaping block when the layer never saw a result", async () => {
    const text = await capture(EMPTY)("--dry-run");
    expect(text).toContain("Jev compaction dry-run");
    expect(text).not.toContain("Immediate result shaping");
  });

  it("reports the shaping counters and the top skip reasons", async () => {
    const text = await capture({
      counters: {
        "resultShaping.seen": 12,
        "resultShaping.eligible": 4,
        "resultShaping.shaped": 3,
        "resultShaping.savedChars": 42000,
      },
      skipReasons: { "too-small": 6, "tool-not-allowed": 2 },
    })("--dry-run");
    expect(text).toContain("Immediate result shaping (this process):");
    expect(text).toContain("seen 12, eligible 4, shaped 3");
    expect(text).toContain("saved 42,000 chars");
    expect(text).toContain("skipped: too-small=6 tool-not-allowed=2");
    // The historical layer's own numbers stay separate.
    expect(text).toContain("Estimated visible text reduction: 600 chars");
  });

  it("reports a failing run instead of a report", async () => {
    const text = await capture(EMPTY)("");
    expect(text).toContain("Estimated visible text reduction");
  });
});
