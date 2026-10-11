import { describe, expect, it } from "vitest";
import {
  buildForkSeed,
  SessionId,
  SessionSeq,
  Session,
  SessionLogOffset,
} from "@deepseek-ai/dsh-session";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { qaForkBoundary } from "../../src/session-fork.js";
import { qaDelegatedHeader } from "../../src/shared/session-lineage.js";

export const forkEvents = [
  { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
  {
    seq: 1,
    time: 2,
    type: "user/message",
    surfaceOp: "append",
    data: {
      id: "input-1",
      role: "user",
      source: { kind: "user" },
      turn: 1,
      content: [{ type: "text", text: "First question" }],
    },
  },
  {
    seq: 2,
    time: 3,
    type: "assistant/message",
    surfaceOp: "append",
    data: {
      stream: [],
      step: 1,
      turn: 1,
      message: {
        id: "answer-1",
        role: "assistant",
        source: {
          kind: "model",
          provider: "demo-provider",
          model: "demo-model",
        },
        content: [{ type: "text", text: "First answer" }],
      },
    },
  },
  {
    seq: 3,
    time: 4,
    type: "turn/end",
    data: { turn: 1, reason: { kind: "done" } },
  },
  { seq: 4, time: 5, type: "turn/start", data: { turn: 2 } },
  {
    seq: 5,
    time: 6,
    type: "user/message",
    surfaceOp: "append",
    data: {
      id: "input-2",
      role: "user",
      source: { kind: "user" },
      turn: 2,
      content: [{ type: "text", text: "Later question" }],
    },
  },
] as unknown as readonly SessionEvent[];

describe("QA exact-history branch", () => {
  it("cuts at the chosen completed turn while the parent's next turn is running", () => {
    const before = JSON.stringify(forkEvents);
    const boundary = qaForkBoundary(forkEvents, 2);
    expect(boundary).toEqual({ atSeq: 3, turn: 1 });
    const seed = buildForkSeed(forkEvents, SessionSeq(boundary.atSeq));
    expect(seed.slice(0, 4)).toEqual(forkEvents.slice(0, 4));
    expect(seed[4]?.type).toBe("session/end-seed");
    expect(
      seed.some(
        (event) => event.type === "turn/start" && event.data.turn === 2,
      ),
    ).toBe(false);
    expect(JSON.stringify(forkEvents)).toBe(before);
    const child = Session.create(
      SessionId("branch"),
      seed,
      { version: 4, id: SessionId("branch"), createdAt: 10, isSeeded: true },
      SessionLogOffset(4),
    );
    expect(child.inheritedEventCount).toBe(4);
    expect(child.snapshotEvents().slice(0, 4)).toEqual(forkEvents.slice(0, 4));
  });

  it.each([-1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 99, 0, 1])(
    "refuses a missing, non-answer or invalid position %s",
    (seq) => {
      expect(() => qaForkBoundary(forkEvents, seq)).toThrow();
    },
  );
  it("refuses an unfinished answer and an intermediate assistant message", () => {
    expect(() => qaForkBoundary(forkEvents.slice(0, 3), 2)).toThrow(
      "not completed",
    );
    const tail = { ...forkEvents[2], seq: 3 } as SessionEvent;
    expect(() => qaForkBoundary([...forkEvents.slice(0, 3), tail], 2)).toThrow(
      "final answer",
    );
  });
  it("keeps ordinary seeded branches distinct from delegated children", () => {
    expect(qaDelegatedHeader({ parentSession: "parent", isSeeded: true })).toBe(
      false,
    );
    expect(qaDelegatedHeader({ parentSession: "parent" })).toBe(true);
    expect(
      qaDelegatedHeader({
        parentSession: "parent",
        isSeeded: true,
        origin: "subagent",
      }),
    ).toBe(true);
  });
});
