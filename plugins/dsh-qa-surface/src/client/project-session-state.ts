import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  QaPendingApproval,
  QaPendingQuestion,
  QaQueueRow,
  QaQueueStatus,
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
  /**
   * The Host's Inbox projection for this session: the messages waiting for the
   * agent's next turn. A projection key the Host has not published reads as an
   * empty list, which is what a session with no queued work shows anyway.
   */
  readonly queuedMessages: readonly UserMessage[];
  /**
   * Queued submissions this binding has already seen in {@link queuedMessages}
   * — the mask {@link projectQueue} draws with, and empty against a session
   * library that retires an echo when its queue occurrence arrives.
   */
  readonly admittedSubmissions: ReadonlySet<string>;
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
  /**
   * A send the stand had no room for. The dialog is the whole of what the
   * visitor learns: the question never reached the Host, so the transcript has
   * no row to carry the refusal on. Distinct from `queue`, the waiting rows of
   * this chat.
   */
  readonly requestQueue: QaQueueStatus | null;
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
 * The submission echoes the Host's queue carries, keyed by request id. A queued
 * message lists the echo it answers for, which is what keeps one send from
 * reading as two rows while it is both in transport and admitted.
 */
export function admittedSubmissionIds(
  queued: readonly UserMessage[],
): Set<string> {
  return new Set(
    queued.flatMap((message) => {
      const rpcId = (message.source as { readonly rpcId?: unknown }).rpcId;
      return rpcId === undefined ? [] : [String(rpcId)];
    }),
  );
}

/**
 * Messages waiting for the agent's next turn, in the order the Host will claim
 * them. An admitted row comes from the Host's Inbox projection; a row still
 * crossing the transport comes from the submission echo registered for it, so
 * one queued send reads as one row at every moment.
 *
 * That echo is the browser's own, and its retirement is the session library's
 * job. `@deepseek-ai/dsh-api-session-controller` — the harness's
 * `packages/api/session-controller`, pinned at 0.1.7-rc.2 — documents
 * `SessionSnapshot.pendingSubmissions` as "Local prompt-submission echoes not
 * yet observed as durable events or queue occurrences" and `beginSubmission`
 * as "Queued echoes retire on queue acceptance", that retirement being the
 * `observed` branch of `PendingSubmissionRetirement`. The card measured a row
 * that survived the claim its own queue occurrence had proved and left the
 * screen only on a page reload — under that declaration, an echo outliving the
 * occurrence that should have retired it: the strip then drew the survivor as a
 * buttonless «отправляется…» row over a question the transcript had answered.
 *
 * So while that contract goes unmet, a submission the Inbox has once listed is
 * treated as settled and never drawn as crossing. The follow-up belongs to the
 * retirement named above, not to this package; the mask is a client-side
 * substitute for it, and carries three limits with it:
 * - it is terminal, so a message taken out of the queue without being handed
 * to the turn leaves no row either — the browser cannot tell the two cases;
 * - it lives for one binding, so re-subscribing a chat whose session object
 * still registers the echo draws the row again;
 * - the receipt is dropped by the first frame that stops registering the echo,
 * which is what a library honouring the contract looks like and also what a
 * frame carrying no local echoes looks like: such a frame re-draws
 * «отправляется…» over a message the queue already named.
 * A release that retires the echo at acceptance leaves this set empty on every
 * frame, and then the filter is dead code to delete.
 */
function projectQueue(
  snapshot: QaBoundProjectionInput["sessionSnapshot"],
  queued: QaBoundProjectionInput["queuedMessages"],
  admitted: QaBoundProjectionInput["admittedSubmissions"],
): readonly QaQueueRow[] {
  const echoed = admittedSubmissionIds(queued);
  const sending = snapshot.pendingSubmissions
    .filter(
      (item) =>
        item.placement === "queued" &&
        !echoed.has(String(item.requestId)) &&
        !admitted.has(String(item.requestId)),
    )
    .map((item) => ({
      id: String(item.requestId),
      preview: queuePreview(item.text),
      text: item.text,
      attachments: item.attachments.length,
      sending: true,
    }));
  return [
    ...queued.map((message) => {
      const texts = message.content.flatMap((block) =>
        block.type === "text" ? [block.text] : [],
      );
      const plainText = texts.join("\n\n");
      return {
        id: String(message.id),
        preview: queuePreview(plainText),
        // A row that mixes in non-text content cannot be re-sent as plain text,
        // so it is previewed but not editable, exactly as the Host docks it.
        text: message.content.every((block) => block.type === "text")
          ? plainText
          : null,
        attachments: message.content.filter(
          (block) => block.type === "image" || block.type === "file",
        ).length,
        sending: false,
      };
    }),
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
    queue: projectQueue(
      snapshot,
      input.queuedMessages,
      input.admittedSubmissions,
    ),
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
    requestQueue: input.requestQueue,
    // A read-only binding issues no Host operation at all, and running a
    // command is one — the policy gate closes the palette with everything else.
    slash:
      input.compatibilityReadOnly === true
        ? { ...input.slash, enabled: false, entries: [] }
        : input.slash,
  };
}
