import { describe, expect, it } from "vitest";
import {
  ToolCallId,
  createMessage,
  createToolResultMessage,
} from "@deepseek-ai/dsh-llm";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { Session, SessionId, type SessionSeq } from "@deepseek-ai/dsh-session";
import type { Session as DshSession } from "@deepseek-ai/dsh-session";
import { collectCandidates } from "../../src/planner/collect.js";
import { extractFeatures } from "../../src/planner/features.js";
import { buildPlan } from "../../src/planner/plan.js";
import { decideAction } from "../../src/planner/policy.js";
import { applyPlan, SurfaceChangedError } from "../../src/mutation/apply.js";
import { renderReplacement } from "../../src/mutation/render.js";
import {
  appendToolResultReplacement,
  captureSurfaceSnapshot,
  isSnapshotFresh,
} from "../../src/dsh/surface.js";
import { resolveJevCompactionConfig } from "../../src/config.js";

const MODEL = "test-model";
// Small recent window so multi-turn fixtures keep old results eligible; the
// token pin is disabled for deterministic position-based tests.
const CONFIG = resolveJevCompactionConfig({
  preserve: { recentMessages: 2, recentTokens: 0 },
});

/**
 * Append one closed tool step (mirroring the harness's own pruner fixture):
 * turn/start → step/start → assistant message with one tool call → tool/call
 * → tool/result → step/end → turn/end.
 */
function appendToolStep(
  session: DshSession,
  turn: number,
  call: string,
  content: ContentBlock[],
  options: { error?: boolean } = {},
): number {
  const callId = ToolCallId(call);
  session.append("turn/start", { turn });
  session.append("step/start", { turn, step: 1 });
  session.append(
    "assistant/message",
    {
      stream: [],
      turn,
      step: 1,
      message: createMessage({
        role: "assistant",
        content: [
          { type: "tool-call", id: callId, name: "read", arguments: "{}" },
        ],
        source: { kind: "model", provider: MODEL, model: MODEL },
      }),
    },
    { surfaceOp: "append" },
  );
  session.append("tool/call", {
    turn,
    step: 1,
    callId,
    name: "read",
    arguments: "{}",
  });
  const result = session.append(
    "tool/result",
    {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId,
        content,
        isError: options.error === true,
      }),
    },
    { surfaceOp: "append" },
  );
  session.append("step/end", { turn, step: 1 });
  session.append("turn/end", { turn, reason: { kind: "completed" } });
  return result.seq;
}

function findSeqByCall(session: DshSession, call: string): SessionSeq {
  for (const event of session.snapshotEvents()) {
    if (event.type === "tool/result") {
      const data = event.data as { message: { source: { callId: string } } };
      if (data.message.source.callId === call) return event.seq as SessionSeq;
    }
  }
  throw new Error(`no result for ${call}`);
}

/** Four closed steps plus one open turn, exercising every pin reason. */
function buildSession(id: string): { session: DshSession; oldSeq: number } {
  const session = Session.create(SessionId(id));
  appendToolStep(session, 1, "old-call", [
    { type: "text", text: "x".repeat(4000) },
  ]);
  appendToolStep(session, 2, "fresh-call", [
    { type: "text", text: "f".repeat(4000) },
  ]);
  appendToolStep(
    session,
    3,
    "error-call",
    [{ type: "text", text: "e".repeat(4000) }],
    { error: true },
  );
  appendToolStep(session, 4, "rich-call", [
    { type: "text", text: "y".repeat(4000) },
    {
      type: "image",
      mime: "image/png",
      data: "Zm9v",
    } as unknown as ContentBlock,
  ]);
  session.append("turn/start", { turn: 5 });
  return { session, oldSeq: findSeqByCall(session, "old-call") };
}

describe("surface replacement lifecycle", () => {
  it("collects only eligible candidates: pins recent, errors, and rich results", () => {
    const { session } = buildSession("collect");
    const { candidates } = collectCandidates(session, CONFIG);
    // old-call and fresh-call are eligible; the error result and the
    // rich (non-text block) result are pinned outright.
    expect(candidates.map((candidate) => candidate.callId)).toEqual([
      "old-call",
      "fresh-call",
    ]);
  });

  it("applies a plan and preserves the original event in the durable log", () => {
    const { session, oldSeq } = buildSession("durable");
    const { candidates, callIndex } = collectCandidates(session, CONFIG);
    const features = extractFeatures(candidates, callIndex);
    const candidate = candidates[0]!;
    const text = renderReplacement(
      candidate,
      "KEEP_STUB",
      384,
      128,
      "low semantic retention score",
    );
    const plan = buildPlan(captureSurfaceSnapshot(session), [
      {
        candidate,
        features: features.get(candidate.callId),
        scores: { needContents: 0.1 },
        action: decideAction({ needContents: 0.1 }, CONFIG),
        replacementText: text,
        replacementChars: text.length,
      },
    ]);

    const outcome = applyPlan(session, plan);
    expect(outcome.failure).toBeUndefined();
    expect(outcome.applied).toHaveLength(1);

    // Original event remains in the append-only log, unchanged.
    const original = session.snapshotEvents()[oldSeq]!;
    expect(original.type).toBe("tool/result");
    expect(
      (original.data as ReplacementView).message.content[0]!.content[0]!.text,
    ).toBe("x".repeat(4000));

    // The surface now shows the replacement at that position.
    expect(session.surface.nodes).not.toContain(oldSeq);
    const replacementSeq = outcome.applied[0]!.replacementSeq;
    expect(session.surface.nodes).toContain(replacementSeq);
    const replacement = session.snapshotEvents()[replacementSeq]!;
    expect(replacement.type).toBe("tool/result");
    expect((replacement.data as { turn: number }).turn).toBe(1);
    expect((replacement.data as ReplacementView).message.source.callId).toBe(
      "old-call",
    );
    expect(
      (replacement.data as ReplacementView).message.content[0]!.content[0]!
        .text,
    ).toContain("[dsh-jev-compaction]");
  });

  it("replays to the identical pruned surface after a full reload", () => {
    const { session } = buildSession("replay");
    const { candidates } = collectCandidates(session, CONFIG);
    const candidate = candidates[0]!;
    const text = renderReplacement(
      candidate,
      "KEEP_TRUNCATED",
      384,
      128,
      "partial retention score",
    );
    const outcome = applyPlan(
      session,
      buildPlan(captureSurfaceSnapshot(session), [
        {
          candidate,
          action: "KEEP_TRUNCATED",
          replacementText: text,
          replacementChars: text.length,
        },
      ]),
    );
    expect(outcome.applied).toHaveLength(1);

    const replay = Session.create(session.id, session.snapshotEvents());
    expect(replay.surface.replaceGeneration).toBe(
      session.surface.replaceGeneration,
    );
    expect(replay.surface.nodes).toEqual(session.surface.nodes);
    expect(replay.deriveMessages()).toEqual(session.deriveMessages());
  });

  it("converges: a second pass collects no already-pruned nodes", () => {
    const { session } = buildSession("converge");
    const first = collectCandidates(session, CONFIG);
    const candidate = first.candidates[0]!;
    const text = renderReplacement(
      candidate,
      "KEEP_STUB",
      384,
      128,
      "low semantic retention score",
    );
    applyPlan(
      session,
      buildPlan(captureSurfaceSnapshot(session), [
        {
          candidate,
          action: "KEEP_STUB",
          replacementText: text,
          replacementChars: text.length,
        },
      ]),
    );
    const second = collectCandidates(session, CONFIG);
    expect(second.candidates.map((item) => item.callId)).toEqual([
      "fresh-call",
    ]);
  });

  it("rejects stale plans via snapshot freshness", () => {
    const { session } = buildSession("stale");
    const snapshot = captureSurfaceSnapshot(session);
    const { candidates } = collectCandidates(session, CONFIG);
    const candidate = candidates[0]!;
    expect(isSnapshotFresh(session, snapshot, [candidate.surfaceSeq])).toBe(
      true,
    );

    // External drift: land an unrelated legal replacement (fresh-call).
    const freshSeq = findSeqByCall(session, "fresh-call");
    const freshEvent = session.eventAt(freshSeq)!;
    if (freshEvent.type !== "tool/result") throw new Error("fixture broken");
    const driftText = renderReplacement(
      {
        ...candidate,
        surfaceSeq: freshSeq,
        originalText: "f".repeat(4000),
        originalChars: 4000,
      },
      "KEEP_TRUNCATED",
      384,
      128,
      "partial retention score",
    );
    appendToolResultReplacement(session, freshEvent, driftText);

    expect(isSnapshotFresh(session, snapshot, [candidate.surfaceSeq])).toBe(
      false,
    );
    expect(() =>
      applyPlan(
        session,
        buildPlan(snapshot, [
          {
            candidate,
            action: "KEEP_STUB",
            replacementText: driftText,
            replacementChars: driftText.length,
          },
        ]),
      ),
    ).toThrow(SurfaceChangedError);
  });
});

interface ReplacementView {
  message: {
    source: { callId: string };
    content: [{ content: { type: string; text: string }[] }];
  };
}
