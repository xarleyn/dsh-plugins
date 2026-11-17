import type { Session } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq } from "@deepseek-ai/dsh-session/types";
import {
  deliveredDocuments,
  selectDocument,
  type QaDocumentDelivery,
} from "../shared/document-redelivery.js";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "qa-document-redelivery": {
      readonly kind: "qa-document-redelivery";
      readonly form: "notice";
      readonly summary: string;
      readonly rpcId: string;
      readonly requestText: string;
      readonly file: QaDocumentDelivery | null;
      readonly compound?: true;
    };
  }
}

/** A file transfer is a durable chat action. It neither schedules an agent
 * turn nor gives a reviewer authority to edit the original. */
export function recordDocumentDelivery(
  session: Session,
  rpcId: string,
  requestText: string,
  file: QaDocumentDelivery | null,
  compound = false,
) {
  const summary = file
    ? `Повторно прикреплён файл ${file.name}.`
    : "Уточните название ранее созданного файла DOCX.";
  session.append(
    "user/message",
    createUserMessage({
      content: [{ type: "text", text: summary }],
      source: {
        kind: "qa-document-redelivery",
        form: "notice",
        summary,
        rpcId,
        requestText,
        file,
        ...(compound ? { compound: true as const } : {}),
      },
    }),
    { surfaceOp: "append" },
  );
}

/** Original events behind checkpoints still on this branch's active surface. */
export function activeDocumentHistory(
  session: Session,
  events?: ReturnType<Session["snapshotEvents"]>,
) {
  const active = new Set<number>(session.surface.nodes);
  if (
    !session.surface.nodes.some((seq) => {
      const event = session.eventAt(seq);
      return (
        event?.type === "user/message" &&
        (event.data.source as { kind?: string })?.kind === "compact-checkpoint"
      );
    })
  )
    return active;
  // Compaction is an optional Host plugin; only a checkpoint on this surface
  // admits the originals it replaced, including nested checkpoints.
  const summaries = new Map<string, number[]>();
  for (const event of (events ?? session.snapshotEvents()) as readonly {
    type: string;
    data: { compactionId?: string; shadowedSeqs?: number[] };
  }[]) {
    if (
      event.type === "compaction/summary" &&
      typeof event.data.compactionId === "string" &&
      Array.isArray(event.data.shadowedSeqs)
    )
      summaries.set(event.data.compactionId, event.data.shadowedSeqs);
  }
  for (const seq of active) {
    const e = session.eventAt(SessionSeq(seq));
    if (e?.type !== "user/message") continue;
    const source = e.data.source as { kind: string; compactionId?: string };
    if (source.kind === "compact-checkpoint" && source.compactionId)
      for (const original of summaries.get(source.compactionId) ?? [])
        active.add(original);
  }
  return active;
}

/** Rebuild the selection at this request, even on a short browser history page. */
export function originalDocument(
  session: Session,
  before: number,
  target: string,
) {
  const calls = new Map<string, string>();
  const files: QaDocumentDelivery[] = [];
  const events = session.snapshotEvents();
  const active = activeDocumentHistory(session, events);
  for (const event of events) {
    if (event.seq === undefined) continue;
    if (event.seq >= before) break;
    if (event.type === "tool/call")
      calls.set(String(event.data.callId), event.data.name);
    if (
      event.type !== "tool/result" ||
      !active.has(event.seq) ||
      event.data.error ||
      event.data.message.isError
    )
      continue;
    const message = event.data.message;
    const tool = calls.get(String(message.source.callId));
    if (tool === undefined) continue;
    const text = message.content
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n");
    files.push(...deliveredDocuments(tool, text));
  }
  return selectDocument(files, target);
}
