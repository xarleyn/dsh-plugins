import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  QaPendingApproval,
  QaPendingQuestion,
  QaQueueRow,
  QaSessionState,
  QaSlashView,
  QaSubagentView,
  QaTurnSources,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { projectTranscript } from "./QaTranscriptAdapter.js";

/** Everything the bound-chat projection reads; the computation is pure. */
export interface QaBoundProjectionInput {
  readonly connected: boolean;
  readonly sessionId: string;
  /** Chat identity from the controller; see `QaSessionState.chatKey`. */
  readonly chatKey: number;
  readonly sessionSnapshot: ReturnType<SessionFace["getSnapshot"]>;
  readonly conversationSnapshot: ConversationSnapshot | undefined;
  /** Turn bundles with the Host provenance already merged in (Host wins). */
  readonly sourceBundles: readonly QaTurnSources[];
  /**
   * Tool calls and questions the Host parked for the operator. They are
   * host-side state, not part of the session snapshot, so the controller polls
   * them separately.
   */
  readonly approvals: readonly QaPendingApproval[];
  readonly questions: readonly QaPendingQuestion[];
  readonly operationError: string | null;
  readonly policyReady: boolean;
  /** Historical binding retained for transcript access after policy drift. */
  readonly compatibilityReadOnly?: boolean;
  readonly admissionPending: boolean;
  readonly chatsRevision: number;
  readonly viewingSubagent: QaSubagentView | null;
  /** Slash catalog state of this chat; the controller owns its lifetime. */
  readonly slash: QaSlashView;
  readonly config: ResolvedQaSurfaceConfig;
  /**
   * The chat's subagent display names keyed by session id, read from the
   * host list snapshot; settlement notices prefer them over the raw ids.
   */
  readonly subagentNames?: Readonly<Record<string, string>>;
  /**
   * The chat owner's display name for author labels; present only when an
   * admin reads a foreign chat (chat-level, not per-message).
   */
  readonly author?: string;
}

/** Matches the Host queue strip, which folds a long row into one line. */
const QUEUE_PREVIEW_CHARS = 200;

function queuePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > QUEUE_PREVIEW_CHARS
    ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join("")}…`
    : flat;
}

/**
 * Messages waiting for the agent's next turn, in the order the Host will claim
 * them. An admitted row comes from the Host's queue frame; a row still crossing
 * the transport comes from the echo the Host registered for it, which the Host
 * retires the moment its occurrence appears — so one queued send reads as one
 * row at every moment, and the transcript never shows it twice.
 */
function projectQueue(
  snapshot: QaBoundProjectionInput["sessionSnapshot"],
): readonly QaQueueRow[] {
  const admitted = snapshot.queue.filter((row) => row.placement === "queued");
  const echoed = new Set(
    admitted.flatMap((row) =>
      row.rpcId === undefined ? [] : [String(row.rpcId)],
    ),
  );
  const sending = snapshot.pendingSubmissions
    .filter(
      (item) =>
        item.placement === "queued" && !echoed.has(String(item.requestId)),
    )
    .map((item) => ({
      id: String(item.requestId),
      preview: queuePreview(item.text),
      text: item.text,
      attachments: item.attachments.length,
      sending: true,
    }));
  return [
    ...admitted.map((row) => ({
      id: String(row.id),
      preview: row.preview,
      // A row that mixes in non-text content cannot be re-sent as plain text,
      // so it is previewed but not editable, exactly as the Host docks it.
      text: row.text,
      attachments: row.content.filter(
        (block) => block.type === "image" || block.type === "file",
      ).length,
      sending: false,
    })),
    ...sending,
  ];
}

/**
 * Project one bound chat into the observable surface state: phase, transcript
 * with per-turn sources, footer sources, and the composer's capabilities.
 * Side effects (host-bundle refresh, notifications) live in the controller.
 */
export function projectBoundSessionState(
  input: QaBoundProjectionInput,
): QaSessionState {
  const { config, sessionSnapshot: snapshot } = input;
  // The session snapshot carries no interaction state in 0.1.5: the Host parks
  // a composed gate's `ask` on its own side and the controller polls it, so an
  // unanswered request is visible here without being part of the snapshot.
  const error =
    input.operationError ??
    (snapshot.removed || snapshot.openState === "error"
      ? "Этот чат больше недоступен."
      : null);
  const phase = !input.connected
    ? "reconnecting"
    : snapshot.removed || snapshot.openState === "error"
      ? "error"
      : snapshot.openState !== "open"
        ? "creating"
        : (snapshot.running || input.admissionPending) &&
            input.compatibilityReadOnly !== true
          ? "running"
          : "ready";
  const sourcesByTurn = new Map(
    input.sourceBundles.map((bundle) => [bundle.turn, bundle] as const),
  );
  const messages = projectTranscript(input.conversationSnapshot, {
    running: snapshot.running === true && input.compatibilityReadOnly !== true,
    showToolActivity: config.ui.showToolActivity,
    showReasoning: config.ui.showReasoning,
    subagentNames: input.subagentNames,
    subagentCodenames: config.ui.subagentCodenames,
  }).map((message) => {
    if (message.role === "user" && input.author !== undefined) {
      return { ...message, author: input.author };
    }
    if (message.role !== "assistant" || message.turn === undefined)
      return message;
    const bundle = sourcesByTurn.get(message.turn);
    const sources =
      bundle === undefined
        ? undefined
        : [
            ...bundle.sources,
            ...(config.sources.display.showDiscovered
              ? (bundle.discovered ?? [])
              : []),
          ];
    return sources === undefined || sources.length === 0
      ? message
      : {
          ...message,
          sources,
          sourcesComplete: bundle?.complete ?? true,
          ...(bundle?.incompleteOrigins === undefined
            ? {}
            : { incompleteSourceOrigins: bundle.incompleteOrigins }),
        };
  });
  const latest = input.sourceBundles.at(-1);
  const questions = input.compatibilityReadOnly === true ? [] : input.questions;
  // A parked question owns the composer until it is answered or the turn ends:
  // the operator is answering a tool call that is already waiting, and text
  // sent beside it would open a second turn instead.
  const questionPending = questions.length > 0;
  // Every Host operation the binding may still issue: a read-only historical
  // chat issues none, and a parked question owns the composer until it is
  // answered, because text sent beside it would open a second turn.
  const canOperate =
    input.connected &&
    input.policyReady &&
    !questionPending &&
    input.compatibilityReadOnly !== true;
  return {
    phase,
    sessionId: input.sessionId,
    chatKey: input.chatKey,
    messages,
    pendingMessage: null,
    error,
    compatibilityReadOnly: input.compatibilityReadOnly === true,
    // A running turn has nowhere for a new question to land except its queue,
    // so the composer stays live beside it and the message is admitted as the
    // next turn. A send whose admission has not returned yet stays a lock.
    canSend:
      canOperate &&
      !input.admissionPending &&
      (phase === "ready" || snapshot.running),
    canStop:
      input.connected &&
      snapshot.running &&
      config.ui.showStop &&
      input.compatibilityReadOnly !== true,
    queue: projectQueue(snapshot),
    canEditQueue: canOperate,
    chatsRevision: input.chatsRevision,
    sources:
      latest === undefined
        ? []
        : [
            ...latest.sources,
            ...(config.sources.display.showDiscovered
              ? (latest.discovered ?? [])
              : []),
          ],
    sourcesComplete: latest?.complete ?? true,
    incompleteSourceOrigins: latest?.incompleteOrigins,
    viewingSubagent: input.viewingSubagent,
    approvals: input.compatibilityReadOnly === true ? [] : input.approvals,
    questions,
    // A read-only binding issues no Host operation at all, and running a
    // command is one — the policy gate closes the palette with everything else.
    slash:
      input.compatibilityReadOnly === true
        ? { ...input.slash, enabled: false, entries: [] }
        : input.slash,
  };
}
