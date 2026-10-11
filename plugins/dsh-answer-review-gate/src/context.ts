import type { CandidateSession } from "./candidate.js";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import type { Context } from "@deepseek-ai/cordis";

/** Accumulated human scope decisions, independent of injected model/plugin notes. */
export function reviewConversationContext(session: CandidateSession): string {
  const messages: string[] = [];
  const events = session.snapshotEvents();
  const summaries = new Map<string, readonly number[]>();
  for (const event of events) {
    if (event.type !== "compaction/summary") continue;
    const data = event.data as {
      compactionId?: unknown;
      shadowedSeqs?: unknown;
    };
    if (
      typeof data.compactionId === "string" &&
      Array.isArray(data.shadowedSeqs)
    )
      summaries.set(
        data.compactionId,
        data.shadowedSeqs.filter(
          (seq): seq is number =>
            typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0,
        ),
      );
  }
  // Recover original human input behind active (including nested) checkpoints;
  // neither model-authored summary text nor withdrawn messages become evidence.
  const nodes = new Set(session.surface.nodes);
  const pending = [...nodes];
  for (let index = 0; index < pending.length; index++) {
    const event = session.eventAt(pending[index]!);
    if (event?.type !== "user/message") continue;
    const source = (
      event.data as { source?: { kind?: string; compactionId?: string } }
    ).source;
    if (
      source?.kind !== "compact-checkpoint" ||
      source.compactionId === undefined
    )
      continue;
    for (const seq of summaries.get(source.compactionId) ?? []) {
      if (nodes.has(seq)) continue;
      nodes.add(seq);
      pending.push(seq);
    }
  }
  for (const seq of [...nodes].sort((a, b) => a - b)) {
    const event = session.eventAt(seq);
    if (event?.type !== "user/message") continue;
    const data = event.data as {
      source?: { kind?: string };
      content?: readonly { type: string; text?: string }[];
    };
    if (data.source?.kind !== "user") continue;
    messages.push(
      `Human message ${seq}: ${(data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")}`,
    );
  }
  const questions = new Map<string, string>();
  for (const event of events) {
    const data = event.data as {
      name?: string;
      callId?: string;
      arguments?: string;
      message?: {
        toolCallId?: string;
        isError?: boolean;
        content?: readonly { type: string; text?: string }[];
      };
    };
    if (
      event.type === "tool/call" &&
      data.name === "ask_user_question" &&
      data.callId !== undefined
    )
      questions.set(data.callId, data.arguments ?? "");
    const message = data.message;
    if (
      event.type === "tool/result" &&
      message?.toolCallId !== undefined &&
      message.isError !== true &&
      questions.has(message.toolCallId)
    ) {
      messages.push(
        `Human question form ${questions.get(message.toolCallId)}; recorded answer: ${(
          message.content ?? []
        )
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n")}`,
      );
    }
  }
  const complete = messages.join("\n\n");
  return complete.length <= 24_000
    ? complete
    : `[Earlier human context was omitted. Claims depending on it cannot be verified from this packet.]\n${complete.slice(-24_000)}`;
}

/** The primary agent's effective wire tool schemas, never the reviewer's smaller catalog. */
export function primaryReviewTools(
  agent: unknown,
): readonly string[] | undefined {
  const ctx = (
    agent as {
      ctx?: {
        tools?: { schemas(scope: unknown): readonly { name: string }[] };
      };
    }
  )?.ctx;
  if (ctx?.tools?.schemas === undefined) return undefined;
  return [
    ...new Set(
      ctx.tools
        .schemas(scopeOf(ctx as unknown as Context) ?? agent)
        .map((schema) => schema.name),
    ),
  ].sort();
}
