/**
 * Shared session fixtures for integration tests. Mirrors the harness's own
 * tool-result-pruner fixture shape: closed tool steps plus one open turn.
 */

import {
  ToolCallId,
  createMessage,
  createToolResultMessage,
} from "@deepseek-ai/dsh-llm";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import type { Session as DshSession } from "@deepseek-ai/dsh-session";
import type { AgentLike, TokenMeterLike } from "../../src/dsh/types.js";
import type {
  JevAnswers,
  JevQuestion,
  JevState,
  SystemOneBackend,
} from "../../src/jev/types.js";

/** Append one closed tool step; returns the tool/result event seq. */
export function appendToolStep(
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
        source: { kind: "model", provider: "test-model", model: "test-model" },
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

/** Four closed steps (old, fresh, error, rich) plus open turn 5. */
export function buildFixtureSession(id: string): DshSession {
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
  return session;
}

export function fakeAgent(session: DshSession, id = "agent-1"): AgentLike {
  return { id, session };
}

/** Settable fake token meter: constant price per node, controllable total. */
export function fakeTokenMeter(
  tokensPerNode = 100,
): TokenMeterLike & { setTotal(value: number): void } {
  let total = 0;
  return {
    setTotal(value: number): void {
      total = value;
    },
    measure(session: DshSession) {
      const nodes = [...session.surface.nodes].map((seq) => ({
        seq: seq as number,
        heuristicTokens: tokensPerNode,
      }));
      const surfaceTokens = nodes.length * tokensPerNode;
      return {
        logRevision: 0,
        baseline: { kind: "none", tokens: 0 } as const,
        surfaceDeltaTokens: surfaceTokens,
        totalTokens: total > 0 ? total : surfaceTokens,
        surfaceTokens,
        nodes,
      };
    },
    estimateMessage() {
      return tokensPerNode;
    },
  };
}

/** Deterministic fake decision backend keyed by question prefix. */
export class FakeDecisionBackend implements SystemOneBackend {
  constructor(
    private readonly needContents: number | ((callId: string) => number),
  ) {}

  async score(
    _state: JevState,
    questions: readonly JevQuestion[],
  ): Promise<JevAnswers> {
    const answers: JevAnswers = new Map();
    for (const question of questions) {
      if (question.name.startsWith("needContents_")) {
        const callId = question.name.slice("needContents_".length);
        const value =
          typeof this.needContents === "function"
            ? this.needContents(callId)
            : this.needContents;
        answers.set(question.name, value);
      } else {
        answers.set(question.name, 0.5);
      }
    }
    return answers;
  }
}

/** A backend whose every call fails (for fail-open tests). */
export class FailingBackend implements SystemOneBackend {
  async score(): Promise<JevAnswers> {
    throw new Error("jev unavailable");
  }
}
