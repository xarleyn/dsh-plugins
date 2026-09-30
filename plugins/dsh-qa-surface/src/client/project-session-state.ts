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
import { chatLegacyOf } from "./turn-sources.js";

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
   * Request ids this binding has already seen the Host name, out of
   * {@link queuedMessages} and the transcript. The mask {@link projectQueue}
   * draws with while the session library's echo retirement waits on a frame the
   * surface may never get.
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

/** The `source.rpcId` of one Host row, when the Host named the send it carries. */
function rpcIdOf(source: unknown): string | null {
  const rpcId = (source as { readonly rpcId?: unknown } | undefined)?.rpcId;
  return rpcId === undefined || rpcId === null ? null : String(rpcId);
}

/**
 * Request ids the Host's queue carries. A queued message lists the submission it
 * answers for, which is what keeps one send from reading as two rows while it is
 * both in transport and admitted.
 */
function queueNamedIds(queued: readonly UserMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of queued) {
    const id = rpcIdOf(message.source);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/**
 * The request ids the Host has itself named for a send, out of the two lists it
 * publishes: the messages waiting in its Inbox and the durable input rows of its
 * transcript (`user` opens the turn that took the message, `steering` is one
 * injected into the turn already running). Either is the server's own receipt
 * that the message crossed, and reading both is what makes the receipt
 * independent of which frame carried the news: a message the turn has claimed is
 * gone from the Inbox yet stays in the transcript, so a send admitted and claimed
 * between two notifications is still named by the next transcript frame.
 */
export function hostNamedSubmissionIds(
  queued: readonly UserMessage[],
  conversationSnapshot: ConversationSnapshot | undefined,
): Set<string> {
  const ids = queueNamedIds(queued);
  for (const node of chatLegacyOf(conversationSnapshot).nodes) {
    if (node.kind !== "user" && node.kind !== "steering") continue;
    const id = rpcIdOf(node.source);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/**
 * Messages waiting for the agent's next turn, in the order the Host will claim
 * them. An admitted row comes from the Host's Inbox projection; a row still
 * crossing the transport comes from the submission echo registered for it, so
 * one queued send reads as one row at every moment.
 *
 * That echo is the browser's own, and retiring it is the session library's job.
 * `@deepseek-ai/dsh-api-session-controller` — the harness's
 * `packages/api/session-controller`, pinned here at 0.1.7-rc.2 — documents
 * `SessionSnapshot.pendingSubmissions` as "Local prompt-submission echoes not
 * yet observed as durable events or queue occurrences" and `beginSubmission` as
 * "Queued echoes retire on queue acceptance", that retirement being the
 * `observed` branch of `PendingSubmissionRetirement`. It does not complete the
 * removal at acceptance: the settlement is latched and the removal deferred one
 * animation frame (`scheduleObservedRetirement` hands `finishSubmission` to
 * `scheduleFrame`; in the pinned bundle, `lib/client.js:2233` and `:2309`), and
 * `scheduleFrame` falls back to a macrotask only where `requestAnimationFrame`
 * does not exist at all. A surface whose frame clock has stopped therefore never
 * runs the removal while its snapshot notifications keep arriving on microtasks —
 * the card measured exactly that with the browser panel collapsed
 * (`viewport=0x0`): the question and its answer in the feed, and the survivor
 * drawn below it as a buttonless «отправляется…» row that a page reload cleared.
 *
 * So while that removal waits on a clock the surface may not have, a submission
 * the Host has once named is never drawn as crossing. The follow-up belongs to
 * `scheduleObservedRetirement` / `scheduleFrame` in that package: retire a
 * settlement a delivered notification already proved without a frame.
 *
 * The substitute costs no row the contract would have drawn, because the library
 * has already committed to the removal by the time either Host list can name the
 * send: an Inbox frame that lists a queued echo latches the retirement there and
 * then, and so does the durable row that opens the turn (`observeSubmissionMessage`
 * hands the request to `scheduleObservedRetirement`, `lib/client.js:2201` and
 * `:2213`, both landing at `:2233`). A message the Host takes out of its queue
 * without handing it to the turn is therefore not a case this record swallows — its
 * removal was latched the moment the Inbox listed it, and only the frame is
 * missing. The retirements the library runs without a frame are the ones for a send
 * the Host never named at all: the abandon path and a failed prompt
 * (`lib/client.js:1704`, `:1753`), and the splice reporting `outcome === "canceled"`
 * for a settlement it tracked by insertion receipt, which a queued echo never is
 * (`lib/client.js:2164`, `:2186`, `:2245`). So the mask differs from the contract
 * by the clock, never by the outcome.
 *
 * What it costs is the binding rather than a row. `unbind()` drops the record —
 * leaving a chat, opening a subagent view, a policy re-bind and entering a draft
 * all run it — and only a rebind of the same Session object could draw a survivor
 * again. This surface retains under one source, so releasing its reference makes
 * the manager withdraw the instance and dispose it (`lib/client.js:2413`), and the
 * next binding holds a session with no echoes at all; where another holder keeps
 * that object alive, the next Host frame names the send again and re-earns the
 * record, so the row returns for a frame rather than for good.
 *
 * Where the frame clock does run, the library retires the echo on the frame after
 * the claim, so this filter has nothing left to hide; a release that retired at
 * acceptance rather than on a frame would leave it hiding nothing at all, and the
 * filter becomes dead code to delete.
 */
function projectQueue(
  snapshot: QaBoundProjectionInput["sessionSnapshot"],
  queued: QaBoundProjectionInput["queuedMessages"],
  admitted: QaBoundProjectionInput["admittedSubmissions"],
): readonly QaQueueRow[] {
  const echoed = queueNamedIds(queued);
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
