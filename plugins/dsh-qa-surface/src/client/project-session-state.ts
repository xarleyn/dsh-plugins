import type { SessionFace } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  QaPendingApproval,
  QaPendingQuestion,
  QaSessionState,
  QaSubagentView,
  QaTurnSources,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { projectTranscript } from "./QaTranscriptAdapter.js";

/** Everything the bound-chat projection reads; the computation is pure. */
export interface QaBoundProjectionInput {
  readonly connected: boolean;
  readonly sessionId: string;
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
  readonly admissionPending: boolean;
  readonly chatsRevision: number;
  readonly viewingSubagent: QaSubagentView | null;
  readonly config: ResolvedQaSurfaceConfig;
  /**
   * The chat owner's display name for author labels; present only when an
   * admin reads a foreign chat (chat-level, not per-message).
   */
  readonly author?: string;
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
        : snapshot.running || input.admissionPending
          ? "running"
          : "ready";
  const sourcesByTurn = new Map(
    input.sourceBundles.map((bundle) => [bundle.turn, bundle] as const),
  );
  const messages = projectTranscript(input.conversationSnapshot, {
    running: snapshot.running,
    showToolActivity: config.ui.showToolActivity,
    showReasoning: config.ui.showReasoning,
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
  return {
    phase,
    sessionId: input.sessionId,
    messages,
    pendingMessage: null,
    error,
    canSend: input.connected && phase === "ready" && input.policyReady,
    canStop: input.connected && snapshot.running && config.ui.showStop,
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
    approvals: input.approvals,
    questions: input.questions,
  };
}
