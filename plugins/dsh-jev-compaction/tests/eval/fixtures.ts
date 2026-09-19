/**
 * Richer session builders for the evaluation corpus (SPEC §33). Unlike the
 * minimal integration fixtures, these carry per-tool names, argument
 * previews, sized content, error results, and interleaved user text so the
 * twelve scenarios exercise the planner the way real sessions do.
 */

import {
  MessageId,
  ToolCallId,
  createMessage,
  createToolResultMessage,
} from "@deepseek-ai/dsh-llm";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";

/** The session type used across the eval fixtures. */
export type DshSession = Session;

export type CandidateLabel = "must-keep" | "safe-to-truncate" | "safe-to-stub";

export interface EvalStepOptions {
  readonly name: string;
  readonly args: string;
  readonly chars: number;
  readonly isError?: boolean;
  readonly fill?: string;
}

/** Append one closed tool step; returns the tool/result surface seq. */
export function appendEvalStep(
  session: DshSession,
  turn: number,
  callId: string,
  options: EvalStepOptions,
): number {
  const id = ToolCallId(callId);
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
          {
            type: "tool-call",
            id,
            name: options.name,
            arguments: options.args,
          },
        ],
        source: { kind: "model", provider: "test", model: "test-model" },
      }),
    },
    { surfaceOp: "append" },
  );
  session.append("tool/call", {
    turn,
    step: 1,
    callId: id,
    name: options.name,
    arguments: options.args,
  });
  const text = (options.fill ?? "output")
    .repeat(Math.ceil(options.chars / (options.fill ?? "output").length))
    .slice(0, options.chars);
  const result = session.append(
    "tool/result",
    {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId: id,
        content: [{ type: "text", text }] as ContentBlock[],
        isError: options.isError === true,
      }),
    },
    { surfaceOp: "append" },
  );
  session.append("step/end", { turn, step: 1 });
  session.append("turn/end", { turn, reason: { kind: "completed" } });
  return result.seq;
}

/** Append a user message (bare surface event, no turn bracket needed). */
export function appendUserText(
  session: DshSession,
  text: string,
  turn = 0,
): void {
  session.append(
    "user/message",
    {
      id: MessageId(`user-${session.seq}`),
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
      ...(turn > 0 ? { turn } : {}),
    },
    { surfaceOp: "append" },
  );
}

export function newSession(id: string): DshSession {
  return Session.create(SessionId(id));
}
