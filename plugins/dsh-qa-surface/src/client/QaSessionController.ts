import type {
  ConnectionGenerationState,
  SessionId,
} from "@deepseek-ai/dsh-client-connection/client";
import type {
  SessionBinding,
  SessionFace,
  SessionReference,
  SessionReferenceSource,
  SubmissionHandle,
} from "@deepseek-ai/dsh-api-session-controller/client";
import type { ConversationBinding } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { bytesToBase64 } from "./base64.js";
import { qaStorageNamespace } from "../shared/session-key.js";
import type {
  QaAttachmentDraft,
  QaFileDraft,
  QaPendingUserMessage,
  QaQueueOperation,
  QaQueueStatus,
  QaSessionState,
  QaSlashCatalog,
  QaSlashCatalogEntry,
  QaSlashCommandSurface,
  QaSlashView,
  QaSubagentView,
  ResolvedQaSurfaceConfig,
} from "../types.js";
import { resolveSlashRoute } from "./slash/slash-router.js";
import {
  SLASH_DISABLED_COPY,
  slashAttachmentsCopy,
  slashExecuteFailureCopy,
  slashHostRefusalCopy,
  slashRefusalCopy,
  slashWithheldCopy,
} from "./slash/copy.js";
import {
  canOpenAsCompatibilityReadOnly,
  QaPolicyAttestationError,
} from "./attestation.js";
import { QaChatIndex } from "./chat-index.js";
import { isDelegatedSession, visibleSubagentCandidates } from "./lineage.js";
import { SessionAssetRepository } from "./session-assets.js";
import { createQaSession } from "./create-session.js";
import {
  buildQaPromptContent,
  buildQaSlashAttachments,
  stageQaFiles,
} from "./prompt-content.js";
import { attestQaPolicy } from "./session-admission.js";
import { QaHostSourceBridge } from "./session-sources.js";
import { QaHostApprovalBridge } from "./approvals.js";
import { QaHostQuestionBridge } from "./questions.js";
import { StreamPublisher } from "./stream-publisher.js";
import type {
  QaApprovalApi,
  QaConversation,
  QaCreateSession,
  QaFileUpload,
  QaQueueStatusRemote,
  QaSecureSession,
  QaSessions,
  QaSessionsApi,
  QaQuestionApi,
  QaSlashApi,
  QaSourceApi,
  StorageLike,
} from "./types.js";
import { QA_SESSION_IDLE_STATE } from "./types.js";
import type { QaApprovalDecision, QaQuestionAnswerItem } from "../types.js";
import { waitFor } from "./wait-for.js";
import { QA_REGENERATE_MARKER } from "./QaTranscriptAdapter.js";
import { readableSubagentName } from "./settlement.js";
import {
  hostNamedSubmissionIds,
  projectBoundSessionState,
} from "./project-session-state.js";

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    /** The QA surface holds the Session of the chat it is showing. */
    qaSurface: unknown;
  }
}

/**
 * `rc.2` deleted the Host-wide navigation: a Session lives while the view that
 * retained it holds the reference, so binding a chat means retaining it for as
 * long as this controller projects it.
 */
const QA_SURFACE_SESSION_SOURCE = "qaSurface" satisfies SessionReferenceSource;
import {
  chatLegacyOf,
  projectTurnSources,
  sourceAnchorRoot,
} from "./turn-sources.js";

export interface QaAccountsFacade {
  /** The account bearer token, or null while anonymous. */
  readonly token: () => string | null;
  /** Server-owned chat ids; the list authority while accounts are on. */
  readonly ownedIds: () => readonly string[];
  /**
   * The chat owner's display name for author labels; admins see it on
   * foreign chats only, everyone else gets undefined.
   */
  readonly messageAuthorOf: (sessionId: string) => string | undefined;
  /** Called after a new chat binds, so ownership stays current. */
  readonly onSessionCreated: (sessionId: string) => void;
  /** Called when the Host refuses with auth-required (expired/rotated). */
  readonly onAuthRequired: () => void;
}

export interface QaSessionControllerOptions {
  readonly sessions: QaSessions;
  readonly api: QaSessionsApi;
  readonly createSession: QaCreateSession;
  /** Conversation assembly feeding the transcript projection. */
  readonly conversation: QaConversation;
  readonly connection: ConnectionGenerationState;
  readonly config: ResolvedQaSurfaceConfig;
  readonly secureSession: QaSecureSession;
  readonly sourceApi?: QaSourceApi;
  /**
   * The approval half of the Host namespace. Absent on a page built against a
   * Host that does not answer approvals: the surface then never shows a
   * request and keeps the composer as it is.
   */
  readonly approvalApi?: QaApprovalApi;
  /**
   * The question half of the Host namespace. Absent on a page whose Host build
   * does not answer questions: the surface then only renders what it can.
   */
  readonly questionApi?: QaQuestionApi;
  /**
   * The slash half of the Host namespace. Absent on a page whose Host build
   * predates it: the palette then never appears and ordinary prompts keep
   * working, which is exactly the pre-feature behaviour.
   */
  readonly slashApi?: QaSlashApi;
  /**
   * The Host's live read of the request ceiling. Absent on a Host build that
   * predates it — and unanswered, or answered by a deployment that sets no
   * ceiling — the surface sends the way it always did: the ceiling is an
   * arrangement between browsers about how much this stand can take, never a
   * reason a question cannot be asked.
   */
  readonly queueStatus?: QaQueueStatusRemote;
  readonly storage?: StorageLike;
  /**
   * Browser file-upload service, resolved lazily: the page may not serve the
   * upload plugin, and a deployment without it keeps images and text only.
   */
  readonly fileUpload?: () => QaFileUpload | undefined;
  /** Present while the deployment gates QA users with accounts. */
  readonly accounts?: QaAccountsFacade;
  /** Server-validated role requested for newly materialized sessions. */
  readonly initialSubrole?: string | null;
  readonly adminPreview?: boolean;
  readonly timeoutMs?: number;
  /**
   * Minimum spacing between projections of a running turn's stream frames.
   * The host runtime already batches deltas to one notification per
   * animation frame; this ceiling keeps the render path flat on long
   * transcripts and weak hardware. Zero disables the spacing.
   */
  readonly streamIntervalMs?: number;
}

const CONFIGURATION_ERROR = "Настройки помощника недоступны.";

/**
 * How long a catalog answer stays fresh enough to skip a re-read when the
 * palette opens. Short on purpose: the check is one round-trip and a stale
 * palette shows a skill that was deleted or hides one that was just added.
 * No polling loop — the palette opening is the only trigger.
 */
const SLASH_CATALOG_STALE_MS = 3_000;

/**
 * Spacing of the parked-request poll. A request is answered by a person, so a
 * second of latency is invisible; the poll only runs while a turn runs.
 */
const PENDING_POLL_MS = 1_000;

/**
 * Source of chat identities. Page-wide rather than per controller: the surface
 * re-creates this controller whenever the account, the config or the route
 * changes, and a counter that restarted at its first value would name the new
 * controller's chat exactly as it named the old one's — which is how a draft,
 * its attachments and its per-chat UI state walked from one chat into another.
 * `0` stays with `QA_SESSION_IDLE_STATE`, the snapshot the surface reads before
 * any controller exists.
 */
let chatKeySequence = 0;

function nextChatKey(): number {
  chatKeySequence += 1;
  return chatKeySequence;
}

interface PendingSubmission {
  readonly message: QaPendingUserMessage;
  /** Number of durable user rows present before this send started. */
  baselineUserCount: number;
  /**
   * Number of turns the Chat slice had recorded as finished when this send
   * started. A turn that has since closed is the last chance the transcript
   * gets for this question, so it is the fallback that retires the row.
   */
  baselineTurnEnds: number;
  accepted: boolean;
}

/** What the strip says when the Host refuses one queue operation. */
const QUEUE_FAILURE_COPY: Record<QaQueueOperation, string> = {
  edit: "Не удалось изменить сообщение в очереди. Возможно, оно уже отправлено.",
  remove:
    "Не удалось убрать сообщение из очереди. Возможно, оно уже отправлено.",
  steer: "Не удалось отправить сообщение сразу. Попробуйте ещё раз.",
};

/**
 * Image previews for the Host echo of a queued send. A data URL, not the
 * composer's blob URL: the composer revokes the blob the moment the send is
 * accepted, while the Host keeps the echo until its queue occurrence lands.
 * Files are left out — the Host echo wants a durable attachment reference, and
 * a staged receipt is a write handle, not one.
 */
function submissionImages(attachments: readonly QaAttachmentDraft[]): readonly {
  readonly type: "image";
  readonly value: { readonly previewUrl: string; readonly name?: string };
}[] {
  return attachments.flatMap((attachment) =>
    attachment.kind === "image"
      ? [
          {
            type: "image" as const,
            value: {
              previewUrl: `data:${attachment.mediaType};base64,${attachment.data}`,
              name: attachment.name,
            },
          },
        ]
      : [],
  );
}

/**
 * The only module that couples QA behavior to DSH Session/client APIs. It owns
 * the chat lifecycle state machine; the observable wait, browser-local chat
 * bookkeeping and policy-attestation details live in their own modules.
 */
export class QaSessionController {
  private readonly listeners = new Set<() => void>();
  private readonly sessions: QaSessions;
  private readonly createSessionRemote: QaCreateSession;
  private readonly conversation: QaConversation;
  private readonly connection: ConnectionGenerationState;
  private readonly config: ResolvedQaSurfaceConfig;
  private readonly secureSessionRemote: QaSecureSession;
  private readonly sourceApi: QaSourceApi;
  private readonly chats: QaChatIndex;
  private readonly accounts: QaAccountsFacade | undefined;
  /** Slash half of the Host namespace; absent on an older Host build. */
  private readonly slashApi: QaSlashApi | undefined;
  /** Resolved per send: a page without the upload plugin has no receipts. */
  private readonly fileUpload: () => QaFileUpload | undefined;
  /** Per-chat attachment URL cache; blob URLs die with the chat binding. */
  private readonly assets = new SessionAssetRepository();
  private readonly timeoutMs: number;
  /** Spacing for a running turn's stream frames; the policy lives there. */
  private readonly streamPublisher: StreamPublisher;
  private state: QaSessionState = QA_SESSION_IDLE_STATE;
  private session: SessionFace | undefined;
  /** The reference that keeps {@link session} alive; released with the binding. */
  private sessionReference: SessionReference | undefined;
  private conversationBinding: ConversationBinding | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private unsubscribeInbox: (() => void) | undefined;
  private unsubscribeChat: (() => void) | undefined;
  private readonly unsubscribeConnection: () => void;
  private ensuring: Promise<void> | undefined;
  private materializing: Promise<boolean> | undefined;
  private operationError: string | null = null;
  private admissionPending = false;
  private pendingSubmission: PendingSubmission | undefined;
  private pendingSequence = 0;
  /**
   * Request ids this binding has seen the Host name — in the Inbox queue or as a
   * durable transcript row. The mask that keeps an echo the session library
   * failed to retire from coming back as a question still crossing the
   * transport: the retirement is `@deepseek-ai/dsh-api-session-controller`'s own
   * contract, deferred to an animation frame that a surface with no frame clock
   * never runs, and `projectQueue` in project-session-state.ts carries the
   * citation, what the substitute costs and does not cost, and the point where
   * this set is dead code. Kept for the whole binding: a request id is minted per
   * submission, so an id the Host has named can never belong to a later send.
   */
  private readonly admittedSubmissions = new Set<string>();
  private policyReady = false;
  /** Historical transcript retained after the Host classifies policy drift. */
  private compatibilityReadOnly = false;
  private drafting = false;
  /** The chat session to return to when a subagent view closes. */
  private chatSessionId: string | null = null;
  private viewingSubagent: QaSubagentView | null = null;
  private connectedOnce: boolean;
  private disposed = false;
  private generation = 0;
  /**
   * The session the current chat identity names, or null while the chat it
   * names has no session yet. This is what makes the identity a chat identity
   * rather than a counter: {@link bind} compares the session it is about to
   * adopt against it, so any path that ends up in another session takes another
   * identity — and a draft adopting its first session keeps the one it holds.
   * It only ever names a session this controller holds: {@link bind} hands it
   * out once the adoption has cleared every wait that caller asked it to take —
   * a chat is opened and attested, a subagent transcript is only opened — and
   * both a failed adoption and {@link unbind} take it back. The converse does
   * not hold: a held session may name nothing, which is the transcript of an
   * attestation this chat could not pass and whose caller still reads it. So a
   * chat whose first send fell short keeps its identity while naming no session,
   * and the retry — which brings a fresh id — stays in the composer the question
   * was typed into instead of reading as a move to another chat.
   */
  private namedSession: string | null = null;
  /**
   * Chat identity handed to the surface (`QaSessionState.chatKey`). Taken from
   * the page-wide sequence on every move to another chat, and never when the
   * bound draft merely creates its session: a component that keeps per-chat
   * state in React therefore survives the first prompt of a new chat, while two
   * chats never read the same identity.
   */
  private chatKey = nextChatKey();
  private chatsRevision = 0;
  private selectedSubrole: string | null;
  private adminPreview: boolean;
  /** Host-side provenance of the bound chat, merged into the projection. */
  private readonly hostSources: QaHostSourceBridge;
  /** Host-side approvals of the bound chat waiting for the operator. */
  private readonly hostApprovals: QaHostApprovalBridge;
  /** Host-side question requests of the bound chat waiting for the operator. */
  private readonly hostQuestions: QaHostQuestionBridge;
  private readonly queueRemote: QaQueueStatusRemote | undefined;
  /** Last send the stand had no room for; drives the request-ceiling dialog. */
  private requestQueueNotice: QaQueueStatus | null = null;
  /** Set while a running turn is polled for parked requests. */
  private pendingTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * Slash catalog of the bound chat. Keyed by session: it depends on the
   * chat's cwd, its agent composition and its role, so it is dropped with the
   * binding instead of being carried across chats.
   */
  private slashSessionId: string | null = null;
  private slashEntries: readonly QaSlashCatalogEntry[] = [];
  private slashDenied: readonly string[] = [];
  private slashSurface: QaSlashCommandSurface = "unavailable";
  private slashState: QaSlashView["state"] = "idle";
  private slashError: string | null = null;
  private slashLoadedAt = 0;
  private slashLoading: Promise<void> | undefined;
  /** Last published view; its identity is the render signal. */
  private slashViewCache: QaSlashView | undefined;
  /** Bumped to re-open a palette the user dismissed; see `QaSlashView`. */
  private slashReopen = 0;
  /** Chat, connection and admission state of the last one-shot probe. */
  private pendingProbeKey = "";

  constructor(options: QaSessionControllerOptions) {
    this.sessions = options.sessions;
    this.createSessionRemote = options.createSession;
    this.conversation = options.conversation;
    this.connection = options.connection;
    this.config = options.config;
    this.secureSessionRemote = options.secureSession;
    this.sourceApi =
      options.sourceApi ??
      ({
        sources: async () => ({ ok: true as const, value: [] }),
        readSourceFile: async () => ({
          ok: false as const,
          error: "unavailable",
        }),
        listWorkspaceFiles: async () => ({
          ok: false as const,
          error: "unavailable",
        }),
        readWorkspaceFile: async () => ({
          ok: false as const,
          error: "unavailable",
        }),
        previewWorkspaceDocument: async () => ({
          ok: false as const,
          error: "unavailable",
        }),
      } satisfies QaSourceApi);
    this.chats = new QaChatIndex(
      options.storage,
      qaStorageNamespace(options.config),
    );
    this.accounts = options.accounts;
    this.slashApi = options.slashApi;
    this.selectedSubrole = options.initialSubrole ?? null;
    this.adminPreview = options.adminPreview === true;
    this.fileUpload = options.fileUpload ?? (() => undefined);
    this.hostSources = new QaHostSourceBridge(
      this.sourceApi,
      () => this.accounts?.token() ?? "",
    );
    this.hostApprovals = new QaHostApprovalBridge(options.approvalApi);
    this.hostQuestions = new QaHostQuestionBridge(options.questionApi);
    this.queueRemote = options.queueStatus;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.streamPublisher = new StreamPublisher(options.streamIntervalMs ?? 66);
    this.connectedOnce = this.connection.getSnapshot() !== undefined;
    this.unsubscribeConnection = this.connection.subscribe(() => {
      if (this.connection.getSnapshot() !== undefined)
        this.connectedOnce = true;
      this.publish();
    });
  }

  getSnapshot = (): QaSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ensureSession(): Promise<void> {
    if (this.ensuring !== undefined) return this.ensuring;
    const operation = this.ensureSessionNow().finally(() => {
      if (this.ensuring === operation) this.ensuring = undefined;
    });
    this.ensuring = operation;
    return operation;
  }

  /**
   * Select a different capability profile for the next agent. The current
   * agent is never mutated: even a blank materialized chat is abandoned in
   * favor of a fresh Host-owned session.
   */
  async selectSubrole(subroleId: string, adminPreview = false): Promise<void> {
    if (this.disposed) return;
    this.selectedSubrole = subroleId;
    this.adminPreview = adminPreview;
    await this.startDraft(true);
  }

  /**
   * The attested live session a submission may ride, or `undefined` when the
   * caller must abort. Materializing a draft chat, attesting policy and
   * recovering from a stale proof live here, so the prompt path and the
   * command path cannot drift apart on what "ready to send" means.
   */
  private async liveTarget(): Promise<SessionFace | undefined> {
    if (this.session === undefined) {
      // A draft chat materializes its session only now: nothing was created
      // when the user pressed "New chat", so the first submission pays for it.
      if (this.materializing !== undefined) {
        // A first prompt is already paying for the session; this one would
        // only race it. Say so, because the alternative is a silent drop.
        this.refuseSend("Чат ещё создаётся. Отправьте сообщение ещё раз.");
        return undefined;
      }
      if (!this.drafting) {
        this.refuseSend("Не удалось отправить сообщение: чат не открыт.");
        return undefined;
      }
      const created = await this.materializeDraft();
      // A refusal reports itself inside materializeDraft, with the Host's
      // reason, and a draft the user left while it was being created is
      // attested by whichever chat took its place: neither answer here.
      if (!created || this.session === undefined) return undefined;
    }
    const step = await this.attestPolicy();
    if (step.kind === "stale") {
      // The user moved to another chat while the proof was pending; that
      // binding attests through its own flow and must not receive a submission
      // meant for the old one.
      return undefined;
    }
    let attestedId = step.kind === "ok" ? step.sessionId : null;
    if (attestedId === null) {
      attestedId = await this.recoverForSend();
      if (attestedId === null) return undefined;
    }
    // Nothing can interleave between the last await and here, so matching the
    // attested id proves the submission rides exactly the session it proved.
    const target = this.session;
    if (
      this.disposed ||
      target === undefined ||
      String(target.sessionId) !== attestedId
    ) {
      return undefined;
    }
    return target;
  }

  /**
   * Route one composer draft. Ordinary text and a skill invocation both ride
   * the native prompt path — a skill is a gesture inside the prompt, not a
   * call this surface makes — while a human command goes to the Host's command
   * runtime and never becomes a model message.
   */
  async send(
    text: string,
    attachments: readonly QaAttachmentDraft[] = [],
    pick: string | null = null,
  ): Promise<boolean> {
    const prompt = text.trim();
    // Images ride the prompt inline; files must be staged first, because the
    // wire carries a receipt rather than bytes.
    const files = attachments.filter(
      (attachment): attachment is QaFileDraft => attachment.kind === "file",
    );
    if ((prompt === "" && attachments.length === 0) || !this.state.canSend) {
      return false;
    }
    const route = resolveSlashRoute({
      text: prompt,
      enabled: this.config.slashCommands.enabled,
      catalogReady: this.slashCatalogReady(),
      entries: this.slashEntries,
      deniedSkills: this.slashDenied,
      picked: pick,
    });
    if (route.kind === "command") {
      return this.sendCommand(prompt, attachments, files, route.entry);
    }
    if (route.kind === "disabled") {
      this.operationError = SLASH_DISABLED_COPY;
      this.publish();
      return false;
    }
    if (route.kind !== "prompt" && route.kind !== "skill") {
      this.operationError = slashRefusalCopy(route);
      if (route.kind === "unknown" || route.kind === "ambiguous") {
        // Re-open the palette the user had to dismiss to reach this line: the
        // refusal is only useful next to the choices it is talking about.
        this.slashReopen += 1;
      }
      this.publish();
      return false;
    }
    if (route.kind === "prompt" && (route.withheld?.length ?? 0) > 0) {
      // The gesture is real and user-invocable here, and this deployment
      // withholds it. Sending it would let the user believe it took effect —
      // the native consumer refuses the injection, but only after the turn.
      this.operationError = slashWithheldCopy(route.withheld ?? []);
      this.publish();
      return false;
    }
    // A message that joins the queue of a chat which is already answering costs
    // the stand no second place — the turn is running anyway — so the ceiling
    // has nothing to say about it. Read before the round-trip below: asking a
    // busy Host how busy it is, in order to refuse the very queue that keeps
    // the busy chat from stalling, would be the wrong answer twice over.
    const joiningQueue = this.session?.getSnapshot().running === true;
    if (this.config.session.maxActiveRequests > 0 && !joiningQueue) {
      // The ceiling is read before anything is spent. A draft chat has no
      // session yet, so a question this stand has no room for must not
      // materialize one, must not enter the transcript, and must not leave the
      // composer — which is what a refusal ahead of `beginSubmission` buys.
      const bound = this.session;
      const ceiling = await this.readQueueStatus();
      // A chat that went away during the read answers for its own sends. One
      // that merely arrived is this draft's session landing underneath, which
      // the submission rides exactly the way it always did.
      if (this.disposed || (bound !== undefined && this.session !== bound))
        return false;
      if (ceiling !== null && ceiling.full) {
        this.requestQueueNotice = ceiling;
        this.publish();
        return false;
      }
    }
    this.operationError = null;
    this.requestQueueNotice = null;
    // A running turn has nowhere for a new question to land but its queue, and
    // the queue is the Host's state, not the transcript's: echoing it into the
    // transcript would show the same message twice — once waiting, once sent.
    const queueing = this.session?.getSnapshot().running === true;
    // Regeneration rides a hidden marker and must never leak it into the UI.
    const submission =
      prompt === QA_REGENERATE_MARKER || queueing
        ? undefined
        : this.beginSubmission(prompt, attachments);
    let accepted = false;
    let target: SessionFace | undefined;
    let echo: SubmissionHandle | undefined;
    try {
      target = await this.liveTarget();
      if (target === undefined) return false;
      if (submission !== undefined && this.pendingSubmission === submission) {
        // Recovery may have replaced the original chat with a fresh session;
        // reconcile against the actual prompt target, not the abandoned one.
        submission.baselineUserCount = this.state.messages.filter(
          (message) => message.role === "user",
        ).length;
        submission.baselineTurnEnds = this.durableTurnEndCount();
      }
      let receipts = new Map<string, string>();
      if (files.length > 0) {
        const outcome = await stageQaFiles(this.fileUpload(), target, files);
        if (outcome.kind !== "ok") {
          if (this.session === target) {
            this.operationError =
              outcome.kind === "unavailable"
                ? "Вложения недоступны на этом сервере."
                : "Не удалось приложить файл.";
            this.publish();
          }
          return false;
        }
        receipts = outcome.receipts;
        // The upload was an external round-trip: the user may have left this
        // chat or closed the surface while it ran. Re-checked before anything is
        // written to the state and before the prompt is sent, so a draft meant
        // for the abandoned chat cannot land in it or in its replacement.
        if (this.disposed || this.session !== target) return false;
      }
      const content = buildQaPromptContent(prompt, attachments, receipts);
      // A queued send needs the Host's own echo, not the transcript one: the
      // Host mints the identity the prompt carries, retires the echo when its
      // queue occurrence arrives, and retires it again when an identified
      // prompt fails, so the strip never keeps a row the server refused.
      echo = queueing
        ? target.beginSubmission({
            mode: "queue",
            text: prompt,
            attachments: submissionImages(attachments),
          })
        : undefined;
      this.admissionPending = true;
      this.publish();
      const result = queueing
        ? await target.prompt(content, "queue", undefined, echo?.requestId)
        : await target.prompt(content, "queue");
      if (this.session !== target) return false;
      if (!result.ok) {
        this.admissionPending = false;
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
        return false;
      }
      accepted = true;
      if (submission !== undefined && this.pendingSubmission === submission) {
        submission.accepted = true;
      }
      this.publish();
      return true;
    } catch (error) {
      this.admissionPending = false;
      // The prompt call never completed, so nothing settled the echo; a queued
      // row would otherwise sit in the strip claiming to be on its way.
      echo?.abandon();
      console.error("dsh-qa-surface: prompt failed", error);
      if (this.session === target) {
        this.operationError = "Не удалось отправить сообщение.";
        this.publish();
      }
      return false;
    } finally {
      if (
        !accepted &&
        submission !== undefined &&
        this.pendingSubmission === submission
      ) {
        this.pendingSubmission = undefined;
        this.publish();
      }
    }
  }

  /**
   * What the stand answers about its load, or null when it does not answer.
   *
   * Every failure here sends the question anyway. The ceiling exists to keep a
   * weak model from drowning, not to be a door a browser cannot open: an
   * unreadable count says nothing about the load, and refusing a visitor on
   * that would be a worse answer than the one they would have got.
   */
  private async readQueueStatus(): Promise<QaQueueStatus | null> {
    if (this.queueRemote === undefined) return null;
    try {
      const result = await this.queueRemote();
      return result.ok ? result.value : null;
    } catch (error) {
      console.error("dsh-qa-surface: queue status unavailable", error);
      return null;
    }
  }

  /**
   * Close the request-ceiling dialog. Nothing is retried and nothing is
   * dropped: the held-back question is still the composer's own text, so asking
   * it again is the visitor's keystroke, taken once the stand has a place free.
   */
  dismissRequestQueueNotice(): void {
    if (this.requestQueueNotice === null) return;
    this.requestQueueNotice = null;
    this.publish();
  }

  /**
   * Run one admitted human command. The Host answers it and writes the
   * lifecycle into the session log; this method only decides what the composer
   * does next, which is why nothing here creates a pending user row.
   *
   * A refusal keeps the draft and the attachments: the user asked for
   * something the deployment does not allow, and retyping the line is a worse
   * answer than leaving it in place to be edited.
   */
  private async sendCommand(
    line: string,
    attachments: readonly QaAttachmentDraft[],
    files: readonly QaFileDraft[],
    entry: QaSlashCatalogEntry,
  ): Promise<boolean> {
    if (this.slashApi === undefined) {
      this.operationError = SLASH_DISABLED_COPY;
      this.publish();
      return false;
    }
    if (attachments.length > 0 && entry.acceptsAttachments !== true) {
      // Checked here so nothing is staged and no Host round-trip is paid for a
      // submission that cannot be admitted; the Host checks it again anyway.
      this.operationError = slashAttachmentsCopy(entry);
      this.publish();
      return false;
    }
    let target: SessionFace | undefined;
    try {
      target = await this.liveTarget();
      if (target === undefined) return false;
      let receipts = new Map<string, string>();
      if (files.length > 0) {
        const outcome = await stageQaFiles(this.fileUpload(), target, files);
        if (outcome.kind !== "ok") {
          if (this.session === target) {
            this.operationError =
              outcome.kind === "unavailable"
                ? "Вложения недоступны на этом сервере."
                : "Не удалось приложить файл.";
            this.publish();
          }
          return false;
        }
        receipts = outcome.receipts;
        // The upload was an external round-trip: the user may have left this
        // chat or closed the surface while it ran. Re-checked before the command
        // reaches the Host, so a command meant for the abandoned chat cannot run
        // in it or in its replacement.
        if (this.disposed || this.session !== target) return false;
      }
      const result = await this.slashApi.execute(
        this.accounts?.token() ?? "",
        String(target.sessionId),
        line,
        buildQaSlashAttachments(attachments, receipts),
      );
      if (this.session !== target) return false;
      if (!result.ok) {
        this.operationError = slashExecuteFailureCopy(entry);
        this.publish();
        return false;
      }
      if (result.value.kind === "refused") {
        this.operationError = slashHostRefusalCopy(result.value);
        this.publish();
        return false;
      }
      this.operationError = null;
      this.publish();
      return true;
    } catch (error) {
      console.error("dsh-qa-surface: slash command failed", error);
      if (this.session === target) {
        this.operationError = slashExecuteFailureCopy(entry);
        this.publish();
      }
      return false;
    }
  }

  /**
   * Refresh the catalog of the bound chat. Called when a chat binds, and again
   * when the palette opens on a catalog that has had time to go stale: the
   * skill registry has no browser-facing change event, so a skill installed
   * while the page is open is only discovered by asking again.
   */
  async refreshSlashCatalog(force = false): Promise<void> {
    const session = this.session;
    if (session === undefined || this.disposed) return;
    if (!this.config.slashCommands.enabled || this.compatibilityReadOnly) {
      this.applySlashCatalog(String(session.sessionId), null);
      return;
    }
    if (this.slashApi === undefined) {
      this.applySlashCatalog(String(session.sessionId), undefined);
      return;
    }
    if (this.slashLoading !== undefined) return this.slashLoading;
    if (!force && this.slashSessionId === String(session.sessionId)) {
      if (Date.now() - this.slashLoadedAt < SLASH_CATALOG_STALE_MS) return;
    }
    const sessionId = String(session.sessionId);
    this.slashState = "loading";
    this.publish();
    const operation = (async () => {
      try {
        const result = await this.slashApi?.catalog(
          this.accounts?.token() ?? "",
          sessionId,
        );
        if (result === undefined) return;
        if (!result.ok) {
          this.applySlashCatalog(sessionId, undefined);
          return;
        }
        this.applySlashCatalog(sessionId, result.value);
      } catch (error) {
        console.error("dsh-qa-surface: slash catalog failed", error);
        this.applySlashCatalog(sessionId, undefined);
      }
    })().finally(() => {
      if (this.slashLoading === operation) this.slashLoading = undefined;
    });
    this.slashLoading = operation;
    return operation;
  }

  /**
   * Install one catalog answer. `null` means the deployment runs with the
   * slash interface off; `undefined` means the answer never arrived. The
   * difference matters: an unreachable catalog must not turn ordinary prompts
   * into refusals.
   */
  private applySlashCatalog(
    sessionId: string,
    catalog: QaSlashCatalog | null | undefined,
  ): void {
    if (
      this.session === undefined ||
      String(this.session.sessionId) !== sessionId
    ) {
      return;
    }
    this.slashSessionId = sessionId;
    this.slashLoadedAt = Date.now();
    if (catalog === null) {
      this.slashEntries = [];
      this.slashDenied = [];
      this.slashSurface = "unavailable";
      this.slashState = "idle";
      this.slashError = null;
      this.publish();
      return;
    }
    if (catalog === undefined) {
      this.slashEntries = [];
      this.slashDenied = [];
      this.slashSurface = "unavailable";
      this.slashState = "error";
      this.slashError = "Не удалось загрузить команды";
      this.publish();
      return;
    }
    this.slashEntries = catalog.entries;
    this.slashDenied = catalog.deniedSkills;
    this.slashSurface = catalog.commandSurface;
    this.slashState = "ready";
    this.slashError = null;
    this.publish();
  }

  /** Whether the catalog of the bound chat was read successfully. */
  private slashCatalogReady(): boolean {
    return this.slashState === "ready" || this.slashState === "loading";
  }

  /** The slash view of the current state; assembled where the state is. */
  private slashView(): QaSlashView {
    const enabled =
      this.config.slashCommands.enabled &&
      !this.compatibilityReadOnly &&
      this.slashSessionId !== null &&
      this.slashApi !== undefined;
    // Identity is the render signal: this runs on every publish, including
    // every stream frame of a running turn, and the composer is memoized on
    // its props. A fresh object here would re-render the composer for each
    // frame of an answer, which is exactly what its memo exists to prevent.
    const cached = this.slashViewCache;
    if (
      cached !== undefined &&
      cached.enabled === enabled &&
      cached.state === this.slashState &&
      cached.entries === this.slashEntries &&
      cached.commandSurface === this.slashSurface &&
      cached.deniedSkills === this.slashDenied &&
      cached.error === this.slashError &&
      cached.reopen === this.slashReopen
    ) {
      return cached;
    }
    const view: QaSlashView = {
      enabled,
      state: this.slashState,
      entries: this.slashEntries,
      commandSurface: this.slashSurface,
      deniedSkills: this.slashDenied,
      error: this.slashError,
      reopen: this.slashReopen,
    };
    this.slashViewCache = view;
    return view;
  }

  /**
   * Turns the loaded Chat window has recorded as durably finished. The Host
   * writes one per `turn/end`, so the count only moves on a fact the
   * transcript itself carries — unlike the session's running bit, which the
   * list relay can also deliver stale.
   */
  private durableTurnEndCount(): number {
    return chatLegacyOf(this.conversationBinding?.snapshot.getSnapshot())
      .turnEnds.size;
  }

  /** Publish a browser-only copy before any network or Host admission awaits. */
  private beginSubmission(
    text: string,
    attachments: readonly QaAttachmentDraft[],
  ): PendingSubmission {
    const submission: PendingSubmission = {
      message: {
        id: `pending:${++this.pendingSequence}`,
        role: "user",
        text,
        status: "pending",
        timestamp: Date.now(),
        images: attachments.flatMap((attachment) =>
          attachment.kind === "image"
            ? [
                {
                  attachmentId: attachment.id,
                  mediaType: attachment.mediaType,
                  // The composer revokes its blob URL after send succeeds;
                  // the optimistic row may outlive that hand-off.
                  previewUrl: `data:${attachment.mediaType};base64,${attachment.data}`,
                },
              ]
            : [],
        ),
        files: attachments.flatMap((attachment) =>
          attachment.kind === "file"
            ? [
                {
                  attachmentId: attachment.id,
                  name: attachment.name,
                  bytes: attachment.bytes,
                },
              ]
            : [],
        ),
      },
      baselineUserCount: this.state.messages.filter(
        (message) => message.role === "user",
      ).length,
      baselineTurnEnds: this.durableTurnEndCount(),
      accepted: false,
    };
    this.pendingSubmission = submission;
    this.publish();
    return submission;
  }

  /**
   * Ask for a fresh variant of the previous answer. The session has no
   * truncation seam, so this sends the hidden regeneration instruction as an
   * ordinary prompt: the model produces a follow-up turn, the projection
   * hides the marker message, and the consecutive turns read as variants of
   * the original question (switched in the surface).
   */
  async regenerate(): Promise<boolean> {
    return this.send(QA_REGENERATE_MARKER);
  }

  async stop(): Promise<void> {
    const target = this.session;
    if (target === undefined || !this.state.canStop) return;
    try {
      const result = await target.cancel();
      if (this.session !== target) return;
      if (!result.ok) this.operationError = "Не удалось остановить ответ.";
    } catch (error) {
      console.error("dsh-qa-surface: stop failed", error);
      if (this.session !== target) return;
      this.operationError = "Не удалось остановить ответ.";
    }
    this.publish();
  }

  /**
   * Edit, send now, or drop one message that still waits for its turn. Every
   * operation addresses the occurrence id the Host's queue frame carried, so a
   * row the agent claimed a moment ago is refused by the Host rather than
   * quietly dropped here.
   *
   * The answer is the refusal text rather than a flag, and the strip beside the
   * composer keeps showing it: a session frame follows a refusal within
   * milliseconds, and the shared error line is cleared by exactly that frame.
   */
  async queueAction(
    id: string,
    action: QaQueueOperation,
    text = "",
  ): Promise<string | null> {
    const target = this.session;
    if (target === undefined || !this.state.canEditQueue) return null;
    const wire =
      action === "remove"
        ? ({ kind: "remove" } as const)
        : action === "steer"
          ? ({ kind: "steer" } as const)
          : ({ kind: "edit", content: [{ type: "text", text }] } as const);
    try {
      const result = await target.updateQueue(
        // The strip holds the id as text; only the Host's brand knows it back.
        id as Parameters<SessionFace["updateQueue"]>[0],
        wire,
      );
      if (this.session !== target) return null;
      if (!result.ok) return QUEUE_FAILURE_COPY[action];
      this.publish();
      return null;
    } catch (error) {
      console.error("dsh-qa-surface: queue operation failed", error);
      if (this.session !== target) return null;
      return QUEUE_FAILURE_COPY[action];
    }
  }

  /**
   * Enter the "new chat" draft: show an empty composer without creating any
   * session. Nothing appears in the chat list and no Host session is spent
   * until the first prompt is actually sent, which materializes the session
   * lazily ({@link materializeDraft}). Fixed-policy deployments cannot draft.
   *
   * A draft is a chat of its own, so entering one takes the screen the way
   * {@link switchTo} does; see the note where the generation moves. Stopping the
   * turn that was running first takes a round-trip, and a chat opened through it
   * keeps the screen: the draft is what the visitor asked for before that click,
   * so this call gives up rather than taking the chat back from under them.
   */
  async startDraft(policyChange = false): Promise<void> {
    if (
      this.disposed ||
      this.config.session.policy === "fixed" ||
      (!policyChange &&
        this.config.lockdown.enabled &&
        !this.config.lockdown.allowSessionReset)
    )
      return;
    const previous = this.session;
    const owned = this.generation;
    if (
      !this.compatibilityReadOnly &&
      previous?.getSnapshot().running === true
    ) {
      try {
        await previous.cancel();
      } catch (error) {
        console.error("dsh-qa-surface: stop before draft failed", error);
      }
      // Asking the Host to stop a running turn is a round-trip, and the visitor
      // reaches the chat list through it. Whoever took the screen during that
      // window owns it: a draft asked for before the trip would otherwise take
      // the screen back, unbind the chat that had just been adopted, and answer
      // its send with nothing — the same takeover this method's own generation
      // raise exists to stop.
      if (this.disposed || this.generation !== owned) return;
    }
    this.enterDraft();
  }

  /**
   * Put a draft on the screen: no session, so no row in the chat history and no
   * record on the Host until the first prompt is sent into it
   * ({@link materializeDraft}). Taking the screen moves the generation the way
   * every other path that retires a binding does, so an adoption still looking
   * for its session measures itself against the new one rather than taking the
   * draft back.
   *
   * A draft that is already on screen — including one whose first send fell
   * short of a claimed session — keeps its chat identity: a new one rebuilds the
   * composer over the question the visitor is still looking at.
   */
  private enterDraft(): void {
    this.generation += 1;
    this.materializing = undefined;
    this.drafting = true;
    if (this.namedSession !== null) {
      this.openChat();
    } else {
      // The identity stays, so the composer keeps the text its question was
      // typed into — but the send that chat had in flight is retired with it:
      // the projection reads the optimistic row and the busy flag out of it
      // without asking which chat is on screen.
      this.pendingSubmission = undefined;
      this.admissionPending = false;
    }
    this.unbind();
    this.operationError = null;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatKey: this.chatKey,
      chatsRevision: this.chatsRevision,
    };
    this.publish();
  }

  /**
   * Turn the current draft into a real attested session. Runs inside the
   * send flow; concurrent sends share one materialization. A refusal here is
   * reported at once — a fresh session's first attestation is the
   * deployment's only chance to learn the reason.
   */
  private materializeDraft(): Promise<boolean> {
    if (this.materializing !== undefined) return this.materializing;
    const operation = ++this.generation;
    const attempt = (async () => {
      try {
        await this.waitForConnection();
        const id = await createQaSession({
          createSession: this.createSessionRemote,
          token: this.accounts?.token() ?? "",
          subroleId: this.selectedSubrole,
          adminPreview: this.adminPreview,
        });
        if (this.disposed || operation !== this.generation) return false;
        // A step back is not a materialized draft: this adoption never ended up
        // holding a session, so the draft has to stay a draft. Calling it done
        // leaves a chat with neither a session nor a draft behind, and every
        // later question in it answered with "chat not open".
        if (!(await this.bind(id, { operation }))) return false;
        if (this.disposed || operation !== this.generation) return false;
        this.drafting = false;
        if (this.config.session.policy === "browser-persistent") {
          this.chats.saveActive(id);
        }
        return true;
      } catch (error) {
        if (this.disposed || operation !== this.generation) return false;
        this.fail(
          this.operationError === CONFIGURATION_ERROR
            ? this.operationError
            : "Не удалось начать чат.",
          error,
        );
        return false;
      }
    })();
    this.materializing = attempt;
    this.publish();
    // `attempt` never rejects: every failure path is caught and reports false.
    void attempt.then(() => {
      if (this.materializing === attempt) this.materializing = undefined;
    });
    return attempt;
  }

  /**
   * Open one of this browser's indexed chats. The id must be present in the
   * host session list and pass policy attestation; an unknown id is forgotten
   * from the index. Fixed-policy deployments cannot switch.
   */
  async switchTo(sessionId: string): Promise<void> {
    if (this.disposed || this.config.session.policy === "fixed") return;
    if (
      this.session !== undefined &&
      String(this.session.sessionId) === sessionId
    )
      return;
    const operation = ++this.generation;
    this.drafting = false;
    this.openChat();
    this.viewingSubagent = null;
    this.unbind();
    this.operationError = null;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatKey: this.chatKey,
      chatsRevision: this.chatsRevision,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      const list = await waitFor(
        this.sessions.list,
        (snapshot) => snapshot.phase === "ready",
        this.timeoutMs,
      );
      if (this.disposed || operation !== this.generation) return;
      // `hasOwn`, not a plain read: the index is browser storage, and a key
      // like `__proto__` must not resolve to something inherited.
      const summary = Object.hasOwn(list.byId, sessionId)
        ? list.byId[sessionId as SessionId]
        : undefined;
      // A delegated child is not a chat, even when this browser's index still
      // names one: the entry is dropped the same way an unknown id is, so a
      // subagent transcript can never be reopened as chat history.
      if (summary === undefined || isDelegatedSession(summary)) {
        this.forgetChat(sessionId);
        throw new Error("Этот чат больше недоступен.");
      }
      const adopted = await this.bind(sessionId, {
        operation,
        allowCompatibilityReadOnly: true,
      });
      // The chat this switch was asked for is on screen only if this adoption
      // finished: a step back means another chat took the screen in the meantime,
      // and persisting this id as the open one would reopen it on the next load.
      if (!adopted) return;
      if (this.disposed || operation !== this.generation) return;
      this.chats.saveActive(sessionId);
    } catch (error) {
      // A newer operation superseded this switch: its own outcome governs.
      if (this.disposed || operation !== this.generation) return;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
    }
  }

  /**
   * Watch a subagent's transcript live. The binding is read-only by
   * construction: no attestation runs (attestation admits sending, and the
   * composer stays disabled here), the chat index is untouched, and
   * {@link closeSubagent} returns to the chat the panel was opened from.
   */
  async viewSubagent(id: string, title: string): Promise<void> {
    if (this.disposed) return;
    if (
      this.viewingSubagent !== null &&
      this.viewingSubagent.id === id &&
      this.session !== undefined
    ) {
      return;
    }
    const operation = ++this.generation;
    this.drafting = false;
    this.openChat();
    this.viewingSubagent = { id, title };
    this.unbind();
    this.operationError = null;
    this.policyReady = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatKey: this.chatKey,
      chatsRevision: this.chatsRevision,
      viewingSubagent: this.viewingSubagent,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      // A step back here is the visitor having left this view for another chat,
      // which shows its own transcript — there is nothing of ours left to publish
      // and nothing of theirs to mark as a failed open.
      if (
        !(await this.bind(id, {
          operation,
          attest: false,
          track: false,
          report: false,
        }))
      )
        return;
    } catch (error) {
      // A newer operation superseded this view request: leave its state alone.
      if (this.disposed || operation !== this.generation) return;
      this.viewingSubagent = null;
      this.fail("Не удалось открыть транскрипт субагента.", error);
    }
    if (this.disposed || operation !== this.generation) return;
  }

  /** Leave the subagent transcript and re-open the chat it was launched from. */
  async closeSubagent(): Promise<void> {
    const chat = this.chatSessionId;
    if (chat === null) return;
    await this.switchTo(chat);
  }

  /**
   * This browser's chat ids: the account's owned chats while accounts are on,
   * else the browser-local index. Either way they intersect the host session
   * list at projection time.
   *
   * The local index is what this browser accumulated, not an identity: with
   * accounts on it is the set the page *claims* at login, never one it lists.
   * Unioning it in would show a chat another account started — its title, its
   * timestamp, its live activity — on a shared browser, and a chat this page
   * has yet to claim is added to the owned list by the claim itself, so the
   * index has nothing left to supply.
   */
  chatIds(): readonly string[] {
    const accounts = this.accounts;
    if (accounts === undefined) return this.chats.chatIds();
    return accounts.ownedIds();
  }

  /** The bound session id, or null while no chat is bound. */
  activeSessionId(): string | null {
    return this.session === undefined ? null : String(this.session.sessionId);
  }

  /**
   * Resolve one durable image attachment of the bound session into a
   * browser-usable URL. Resolutions are cached per chat in the asset
   * repository (attachment ids repeat across chats) and revoked when the chat
   * is unbound; failures surface as broken views and retry on demand.
   */
  async readImage(attachmentId: string): Promise<string> {
    if (this.session === undefined) throw new Error("no bound session");
    const sessionId = String(this.session.sessionId);
    return this.assets.resolve(sessionId, attachmentId, (id) =>
      this.readAttachmentUrl(id),
    );
  }

  private async readAttachmentUrl(attachmentId: string): Promise<string> {
    const session = this.session;
    if (session === undefined) throw new Error("no bound session");
    const result = await session.readAttachment(
      attachmentId as Parameters<SessionFace["readAttachment"]>[0],
    );
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const { attachment, data } = result.value;
    if (typeof URL.createObjectURL !== "function") {
      return `data:${attachment.mediaType};base64,${bytesToBase64(data)}`;
    }
    return URL.createObjectURL(
      new Blob([Uint8Array.from(data).buffer as ArrayBuffer], {
        type: attachment.mediaType,
      }),
    );
  }

  /**
   * Remove one chat from this browser's index. Deleting the chat that is
   * currently open also forgets the persisted id and starts a fresh attested
   * session (when the deployment allows session resets); the Host-side
   * session itself is not touched — no host deletion seam exists.
   */
  async deleteChat(id: string): Promise<void> {
    this.forgetChat(id);
    this.chatsRevision += 1;
    if (
      this.activeSessionId() === id &&
      this.config.session.policy !== "fixed"
    ) {
      // No replacement session is created: deleting the open chat falls back
      // to a draft, and the next prompt materializes a fresh one. The stale
      // persisted id is dropped so a reload cannot resurrect the deleted chat.
      this.chats.clearActive();
      await this.startDraft();
      return;
    }
    this.publish();
  }

  /** Drop one chat id from this browser's index. */
  forgetChat(sessionId: string): void {
    this.chats.forgetChat(sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.streamPublisher.clear();
    this.unsubscribeConnection();
    this.unbind();
    this.assets.dispose();
    this.listeners.clear();
  }

  private async ensureSessionNow(): Promise<void> {
    // A load with no chat to resume opens a draft rather than a chat: the
    // session — and with it its row in the history and its ownership record on
    // the Host — is spent only on the first prompt sent into it
    // ({@link materializeDraft}). Without this, every visit to the surface left
    // one more blank «Новый чат» behind, and one more live Host session nobody
    // asked for. A fixed-policy deployment has one session to show and cannot
    // draft, so it keeps its own path.
    const resumable =
      this.config.session.policy === "browser-persistent" &&
      this.chats.activeId() !== null;
    if (this.config.session.policy !== "fixed" && !resumable) {
      this.enterDraft();
      return;
    }
    const operation = ++this.generation;
    this.drafting = false;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatKey: this.chatKey,
      chatsRevision: this.chatsRevision,
      phase: "creating",
    };
    this.emit();
    try {
      await this.waitForConnection();
      const list = await waitFor(
        this.sessions.list,
        (snapshot) => snapshot.phase === "ready",
        this.timeoutMs,
      );
      let id: string | null = null;
      let restored = false;
      let existing = false;
      if (this.config.session.policy === "fixed") {
        id = this.config.session.fixedSessionId;
        if (id === null || !Object.hasOwn(list.byId, id)) {
          throw new Error("Configured fixed session is unavailable.");
        }
        existing = true;
      } else if (this.config.session.policy === "browser-persistent") {
        const stored = this.chats.activeId();
        const summary =
          stored !== null && Object.hasOwn(list.byId, stored)
            ? list.byId[stored as SessionId]
            : undefined;
        // A stored id that is not a chat any more — a delegated child this
        // browser once opened as one, a session the Host no longer lists —
        // falls through to a draft instead of restoring a transcript nobody can
        // send into.
        if (
          stored !== null &&
          summary !== undefined &&
          !isDelegatedSession(summary)
        ) {
          id = stored;
          restored = true;
          existing = true;
        } else if (stored !== null) {
          this.chats.clearActive();
        }
      }
      if (id === null) {
        // The persisted id names nothing this browser may reopen; that is the
        // same case as a load with no id at all, so it drafts too. The prompt
        // the visitor sends next materializes the chat it belongs to.
        this.enterDraft();
        return;
      }
      if (this.disposed || operation !== this.generation) return;
      // A restored id's first bind stays quiet: the recovery path below may
      // replace it. A freshly created session must report a refusal at once —
      // it is the deployment's only chance to learn the reason.
      try {
        // A step back is not a refusal: another operation owns the screen now,
        // so this bootstrap must neither run its recovery ladder over it nor
        // persist a chat it never adopted.
        if (
          !(await this.bind(id, {
            operation,
            report: !restored,
            allowCompatibilityReadOnly: existing,
          }))
        )
          return;
      } catch (error) {
        // A stale restore must not start its recovery ladder against a newer
        // operation; rethrow for the generation-guarded outer catch.
        if (this.disposed || operation !== this.generation) throw error;
        if (
          !restored ||
          this.config.session.policy !== "browser-persistent" ||
          !(error instanceof QaPolicyAttestationError)
        ) {
          throw error;
        }

        // A stored id is only a hint. If Host refuses that session under the
        // current QA policy (for example after the configured preset changes),
        // forget it and bootstrap one fresh, policy-attested session instead.
        this.unbind();
        this.operationError = null;
        this.chats.clearActive();
        // Nothing is published for the replacement yet: until it exists this is
        // still the chat on screen, and a fresh session the stand refuses to
        // create must not cost the visitor the draft they were reading.
        id = await createQaSession({
          createSession: this.createSessionRemote,
          token: this.accounts?.token() ?? "",
          subroleId: this.selectedSubrole,
          adminPreview: this.adminPreview,
        });
        if (this.disposed || operation !== this.generation) return;
        // The replacement is another chat — empty, and not one the user asked to
        // open — so it takes an identity of its own, dropping the refused chat's
        // unsent text, staged attachments and drawers rather than handing them
        // to a conversation nobody chose. The bind that refused it left the
        // identity naming no session, so without this the replacement would
        // adopt the refused chat's.
        this.openChat();
        if (!(await this.bind(id, { operation }))) return;
      }
      if (this.disposed || operation !== this.generation) return;
      if (this.config.session.policy === "browser-persistent") {
        this.chats.saveActive(id);
      }
    } catch (error) {
      // A newer operation superseded this bootstrap: its own outcome governs.
      if (this.disposed || operation !== this.generation) return;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось начать чат.",
        error,
      );
    }
  }

  /**
   * Recovery ladder after a refused send-time attestation. The prompt was
   * never admitted, so nothing here can duplicate it. Step 1 re-opens the
   * session: a Host that idled the agent out dismantles its tool view, and
   * re-opening re-materializes it. Step 2 — when that refused session is
   * still blank (it never received the prompt, so there is nothing to lose) —
   * starts a fresh attested session instead. A session with history is left
   * alone: recreating it would silently drop the conversation. Returns the
   * attested session id, or null when nothing was attested.
   */
  private async recoverForSend(): Promise<string | null> {
    const id =
      this.session === undefined ? null : String(this.session.sessionId);
    if (
      id === null ||
      this.disposed ||
      this.config.session.policy === "fixed"
    ) {
      return null;
    }
    const operation = ++this.generation;
    this.unbind();
    this.policyReady = false;
    this.state = { ...this.state, phase: "creating" };
    this.emit();
    try {
      await this.waitForConnection();
      try {
        if (!(await this.bind(id, { operation }))) return null;
        if (this.disposed || operation !== this.generation) return null;
        if (this.policyReady) return id;
      } catch (error) {
        if (!(error instanceof QaPolicyAttestationError)) throw error;
        if (this.disposed || operation !== this.generation) return null;
      }
      if (this.session !== undefined && !this.session.getSnapshot().blank) {
        this.fail(CONFIGURATION_ERROR, new QaPolicyAttestationError());
        return null;
      }
      // Only a chat that never received a prompt is replaced here, so the fresh
      // id continues the chat the user is writing into: leaving the binding
      // above takes the identity's name back, and bind() then adopts the fresh
      // id under the identity still on screen — the question this send carries
      // has not left the composer.
      this.unbind();
      this.chats.clearActive();
      const created = await createQaSession({
        createSession: this.createSessionRemote,
        token: this.accounts?.token() ?? "",
        subroleId: this.selectedSubrole,
        adminPreview: this.adminPreview,
      });
      if (this.disposed || operation !== this.generation) return null;
      if (!(await this.bind(created, { operation }))) return null;
      if (this.disposed || operation !== this.generation) return null;
      this.chats.saveActive(created);
      return this.policyReady ? created : null;
    } catch (error) {
      if (this.disposed || operation !== this.generation) return null;
      this.fail(
        this.operationError === CONFIGURATION_ERROR
          ? this.operationError
          : "Не удалось открыть этот чат.",
        error,
      );
      return null;
    }
  }

  /**
   * Begin a chat of its own: take a fresh identity from the page-wide sequence,
   * leave it naming no session, and retire the send the ending chat had in
   * flight. Called on every move between chats — reset, switch, subagent view —
   * by {@link bind} when it ends up in a session the identity does not name, and
   * by the bootstrap whose restored chat was refused, for the replacement it is
   * about to open.
   */
  private openChat(): void {
    this.namedSession = null;
    this.chatKey = nextChatKey();
    // A send in flight belongs to the chat that is ending. The projection reads
    // the optimistic row and the busy flag out of it without asking which chat
    // is on screen, so unless it dies here, the chat that takes this identity
    // shows a question it never received and waits for a send it never made.
    this.pendingSubmission = undefined;
    this.admissionPending = false;
  }

  /**
   * Adopt one Host session as the chat on screen: take its binding, wait for it
   * to open, attest the policy, and only then hand the chat identity to the
   * session, so {@link namedSession} never names one this controller does not
   * hold. A caller that asks for no attestation — the subagent view, whose
   * transcript is read rather than written into — is named once its session is
   * open.
   *
   * Answers whether the adoption happened. `true` is a finished one: this call
   * holds the session and the chat identity names it, so the caller may publish
   * what it kept for that chat — the draft it retired, the id it persisted.
   * `false` is a step back: the chat on screen moved on while this call waited,
   * it undoes nothing of the chat that replaced it and leaves the screen holding
   * nothing of this one ({@link stepBack}), and the caller must keep its own
   * state as unclaimed — a draft that was never materialized stays a draft, and a
   * chat that was never adopted is not persisted as the open one.
   *
   * Any of those waits can outlive the operation it belongs to — the user moves
   * to another chat while a first send is still looking for its session. Two
   * questions decide that at each wait: is this still the generation the caller
   * owns, and is this still the session this call took? The first is the page's
   * own — every path that takes the screen raises the generation. The second is
   * kept beside it because a generation only records who was asked to start, not
   * what the controller holds by the time an adoption resumes: a binding
   * somebody else retired in between is no more this one's to finish.
   */
  private async bind(
    id: string,
    options: {
      /** The generation whose adoption this is; see the two guards below. */
      operation: number;
      report?: boolean;
      attest?: boolean;
      track?: boolean;
      allowCompatibilityReadOnly?: boolean;
    },
  ): Promise<boolean> {
    const {
      operation,
      report = true,
      attest = true,
      track = true,
      allowCompatibilityReadOnly = false,
    } = options;
    const reference = this.sessions.retain(id as SessionId, {
      source: QA_SURFACE_SESSION_SOURCE,
    });
    let binding: SessionBinding | undefined = this.sessions.binding(
      id as SessionId,
    );
    try {
      if (binding === undefined) {
        await reference.ready;
        binding = this.sessions.binding(id as SessionId);
      }
      if (binding === undefined) {
        await waitFor(
          this.sessions.list,
          (snapshot) => Object.hasOwn(snapshot.byId, id),
          this.timeoutMs,
        );
        binding = this.sessions.binding(id as SessionId);
      }
    } finally {
      // A binding this controller never got to hold must not leave a reference
      // counting against the Session it could not show.
      if (binding === undefined) reference.release();
    }
    if (binding === undefined)
      throw new Error("Session binding is unavailable.");
    if (this.disposed || operation !== this.generation) {
      // A newer operation owns the chat on screen while this one was still
      // looking for its session. Adopting now would retire the binding that
      // newer operation is showing, so this one gives up before it takes
      // anything; the reference it retained is its own to release.
      reference.release();
      return false;
    }
    // Another session under the identity that named a different one is another
    // chat: it takes its own identity, so nothing the previous chat was holding
    // — an unsent question, staged attachments, an open drawer — walks into it.
    // A chat that names no session adopts under the identity it already has,
    // which is what keeps a retried first send — it brings a fresh id — in the
    // composer the question was typed into.
    if (this.namedSession !== null && this.namedSession !== id) this.openChat();
    this.unbind();
    this.sessionReference = reference;
    this.session = binding.session;
    this.conversationBinding = this.conversation.binding(id as SessionId);
    this.policyReady = false;
    this.compatibilityReadOnly = false;
    this.unsubscribeSession = binding.session.subscribe(() => {
      this.admissionPending = false;
      this.operationError = null;
      this.publishSessionUpdate();
    });
    // The queue strip reads the Inbox projection, which the Host publishes on
    // its own channel: a claim or a splice changes no session snapshot, so the
    // strip would otherwise keep the rows the agent has already taken.
    this.unsubscribeInbox = binding.session.projections
      .faceOf("inbox")
      .subscribe(() => this.publishSessionUpdate());
    // Subscribing the Chat target activates it, so the assembled transcript
    // (nodes, partials, running calls) materializes for the projection.
    this.unsubscribeChat = this.conversationBinding
      .target("chat")
      .subscribe(() => {
        this.publishSessionUpdate();
      });
    try {
      await waitFor(
        binding.session,
        (snapshot) =>
          snapshot.openState === "open" || snapshot.openState === "error",
        this.timeoutMs,
      );
      if (binding.session.getSnapshot().openState !== "open") {
        throw new Error("Session binding could not be opened.");
      }
      if (attest) {
        // Attestation both reads and writes the chat on screen: it proves the
        // session the controller holds and stamps this adoption's verdict onto
        // it. Ask the two questions before spending a proof on the wrong chat,
        // and answer only for the session this call took — not for whichever
        // one the screen holds by the time the proof comes back.
        if (this.stepBack(operation, binding.session)) return false;
        const step = await this.attestPolicy(report, binding.session);
        // A chat that moved on during the proof is attested by whichever
        // adoption holds it now, so this verdict is not this one's to write.
        if (this.stepBack(operation, binding.session)) return false;
        if (step.kind === "refused") {
          if (
            !allowCompatibilityReadOnly ||
            !canOpenAsCompatibilityReadOnly(step.reason)
          ) {
            throw new QaPolicyAttestationError(step.reason);
          }
          // The Host classified the existing binding before returning these
          // reason classes. Preserve the transcript, but never mark the binding
          // policy-ready: every mutating operation remains disabled.
          this.compatibilityReadOnly = true;
          this.operationError = null;
        }
      }
      if (this.stepBack(operation, binding.session)) {
        // The chat on screen moved on while this adoption waited: what replaced
        // it holds the identity now, so there is nothing here left to finish —
        // and this call gives back the binding it installed, which is all the
        // screen ever took from it.
        return false;
      }
      if (track) {
        this.chatSessionId = String(binding.session.sessionId);
        this.viewingSubagent = null;
        this.chats.addChat(String(binding.session.sessionId));
        this.accounts?.onSessionCreated(String(binding.session.sessionId));
      }
    } catch (error) {
      // An adoption that fell short must not leave the chat naming the session
      // it could not finish with: a retried first send brings another id, and an
      // identity still pointing here would read that retry as a move to another
      // chat — rebuilding the composer over the very question that has to go
      // again. A session that never opened is not one this controller holds, so
      // it goes too; a session whose attestation was refused stays, because its
      // caller reads the transcript before deciding whether the chat may be
      // replaced. Once a newer chat has retired the binding this call took, none
      // of it is ours to undo — that chat owns the identity from then on, and
      // there is nothing of ours left installed.
      if (this.ownsAdoption(operation, binding.session)) {
        this.namedSession = null;
        if (!(error instanceof QaPolicyAttestationError)) this.unbind();
      } else if (this.session === binding.session) {
        // Left behind, and the failure is not a caller's to read any more: the
        // hand that took the screen was the bootstrap, which retires nothing, so
        // this adoption's own binding and subscriptions go with this throw.
        this.unbind();
      }
      throw error;
    }
    // Every wait this adoption was asked to take is behind it: only now does the
    // chat take this session as its identity.
    this.namedSession = id;
    this.publish();
    // Deliberately not awaited: the palette is a convenience, and a chat must
    // open at once whether or not the skill and command registries answer.
    void this.refreshSlashCatalog(true);
    return true;
  }

  /**
   * Give up on an adoption the chat on screen has outgrown, and answer whether
   * that is what happened (`true` — the caller has nothing left to publish).
   *
   * Past the binding this call installed a session of its own: the retained
   * reference, the three subscriptions beside it, and whatever those
   * subscriptions write on every frame. The path that took the screen usually
   * retired all of that with its own {@link unbind} — but the bootstrap raises the
   * generation while keeping the transcript readable until its own session
   * exists, and an adoption left behind by it would otherwise go on holding a
   * Host session nobody is in and publishing that chat's frames into the surface:
   * each frame clears the error the bootstrap published and answers for a binding
   * the page has given up on. Undoing the install is therefore this call's own
   * hand — and only its own: the chat that already replaced this one holds the
   * name, the subscriptions and the policy proof, and emptying its screen is the
   * failure this method exists to prevent.
   */
  private stepBack(operation: number, session: SessionFace): boolean {
    if (this.ownsAdoption(operation, session)) return false;
    if (this.session === session) this.unbind();
    return true;
  }

  /**
   * Is this adoption still the one on screen? The generation says whether the
   * operation that asked for it still owns the page — every path that takes the
   * screen raises it, {@link startDraft} among them — and the session says
   * whether the binding this call took is still the one held, which a generation
   * alone cannot answer: a newer chat raises it before it has taken any name, and
   * a caller can retire the binding it holds inside its own generation.
   */
  private ownsAdoption(operation: number, session: SessionFace): boolean {
    return (
      !this.disposed &&
      operation === this.generation &&
      this.session === session
    );
  }

  private unbind(): void {
    this.sessionReference?.release();
    this.sessionReference = undefined;
    this.streamPublisher.clear();
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.unsubscribeInbox?.();
    this.unsubscribeInbox = undefined;
    this.unsubscribeChat?.();
    this.unsubscribeChat = undefined;
    this.conversationBinding = undefined;
    if (this.session !== undefined) {
      // Leaving the chat retires its attachment URLs; a later re-bind
      // re-resolves them from the durable store.
      this.assets.release(String(this.session.sessionId));
    }
    this.session = undefined;
    // A chat that holds no session names no session: {@link bind} hands the
    // identity out only at the end of a finished adoption, and leaving a
    // binding is the hand that takes it back.
    this.namedSession = null;
    this.hostSources.reset();
    this.hostApprovals.reset();
    this.hostQuestions.reset();
    this.stopPendingPolling();
    // The next binding probes the Host again even for the same chat.
    this.pendingProbeKey = "";
    this.admissionPending = false;
    // Request ids are minted per submission, so another chat's queue listing
    // says nothing about this one's submissions still crossing the transport.
    this.admittedSubmissions.clear();
    // A held-back question belongs to the chat that asked it; another binding
    // answers for its own sends.
    this.requestQueueNotice = null;
    this.policyReady = false;
    this.compatibilityReadOnly = false;
    // The catalog belongs to the chat that produced it: another chat has a
    // different cwd, composition and role, so carrying it across would offer
    // actions this chat may not have.
    this.slashSessionId = null;
    this.slashEntries = [];
    this.slashDenied = [];
    this.slashSurface = "unavailable";
    this.slashState = "idle";
    this.slashError = null;
    this.slashLoadedAt = 0;
  }

  private waitForConnection(): Promise<unknown> {
    return waitFor(
      this.connection,
      (description) => description !== undefined,
      this.timeoutMs,
    );
  }

  /** Project one session notification; the running-turn spacing policy
   * (first frame at once, further frames absorbed) lives in the publisher. */
  private publishSessionUpdate(): void {
    // Read before the spacing, from the notification itself: a frame absorbed
    // into a running turn's window is dropped rather than replayed, so an
    // admission landing in such a window would otherwise go unrecorded and the
    // claim frame after it would draw the ghost row this retires.
    this.trackAdmittedSubmissions();
    this.streamPublisher.publish(
      this.session?.getSnapshot().running === true,
      () => this.publish(),
    );
  }

  private publish(): void {
    if (this.disposed) return;
    const connected = this.connection.getSnapshot() !== undefined;
    // A draft is on screen while its chat owns no session. That includes one
    // whose first send created a session the stand then refused to attest:
    // projecting that never-claimed binding would hand the screen to a chat the
    // visitor does not hold and leave the composer disabled with no retry over
    // it, while the draft keeps a sendable composer and the reason above it. A
    // proof still in flight is the other case — the session the question is
    // waiting for is already the chat on screen, and its rows belong there.
    const refusedDraft =
      this.drafting &&
      this.namedSession === null &&
      this.materializing === undefined;
    if (this.drafting && (this.session === undefined || refusedDraft)) {
      // Draft state: an empty writable composer without a bound session. The
      // session list is untouched — nothing exists until the first send.
      const materializing =
        this.materializing !== undefined ||
        this.pendingSubmission !== undefined;
      this.state = {
        ...QA_SESSION_IDLE_STATE,
        chatKey: this.chatKey,
        phase: materializing
          ? "creating"
          : !connected && this.connectedOnce
            ? "reconnecting"
            : "idle",
        error: this.operationError,
        requestQueue: this.requestQueueNotice,
        canSend: connected && !materializing,
        pendingMessage: this.pendingSubmission?.message ?? null,
        chatsRevision: this.chatsRevision,
      };
      this.emit();
      return;
    }
    if (this.session === undefined) {
      this.state = {
        ...this.state,
        phase:
          !connected && this.connectedOnce ? "reconnecting" : this.state.phase,
        error: this.operationError ?? this.state.error,
        requestQueue: this.requestQueueNotice,
      };
      this.emit();
      return;
    }
    const snapshot = this.session.getSnapshot();
    const sessionId = String(this.session.sessionId);
    const conversationSnapshot =
      this.conversationBinding?.snapshot.getSnapshot();
    const projectedSourceBundles = projectTurnSources(
      conversationSnapshot,
      sessionId,
      this.sourceAnchor(sessionId),
    );
    const sourceBundles = this.hostSources.merge(projectedSourceBundles);
    // A delegated child is not attested, so every Host RPC that admits the
    // session refuses it — and its evidence reaches the chat through the
    // inheritance flow anyway. Asking for a child's bundles therefore answers
    // nothing, costs the operator a rejected admission per publish, and leaves
    // the view reading its sources off the transcript projection alone.
    if (!snapshot.running && this.viewingSubagent === null) {
      void this.hostSources.refresh(sessionId, () => this.publish());
    }
    this.probePending(sessionId, connected);
    this.syncPendingPolling(
      snapshot.running === true && !this.compatibilityReadOnly,
    );
    const queuedMessages = this.queuedMessages();
    const projectionInput = {
      connected,
      sessionId,
      chatKey: this.chatKey,
      sessionSnapshot: snapshot,
      conversationSnapshot,
      sourceBundles,
      approvals: this.hostApprovals.list(),
      questions: this.hostQuestions.list(),
      // Ownership is chat-level: every user message of a foreign chat
      // carries its owner's name when an admin reads it.
      author: this.accounts?.messageAuthorOf(sessionId),
      operationError: this.operationError,
      requestQueue: this.requestQueueNotice,
      policyReady: this.policyReady,
      compatibilityReadOnly: this.compatibilityReadOnly,
      admissionPending:
        this.admissionPending || this.pendingSubmission !== undefined,
      chatsRevision: this.chatsRevision,
      viewingSubagent: this.viewingSubagent,
      queuedMessages,
      // The live set, not a copy: `projectQueue` only asks it `has` and keeps no
      // reference, so nothing here could go stale by the next frame.
      admittedSubmissions: this.admittedSubmissions,
      slash: this.slashView(),
      config: this.config,
      subagentNames: this.subagentNames(),
    } as const;
    let projected = projectBoundSessionState(projectionInput);
    const pending = this.pendingSubmission;
    if (pending !== undefined) {
      // The optimistic copy retires on a fact the transcript itself carries —
      // its own row arriving, or a turn closing — and not on the session's
      // running bit: the Session list relays that one too, and a stale false
      // at the start of a turn retired the copy before the Chat slice had
      // assembled the node, which is the frame the question vanished in.
      const committedUserCount = projected.messages.filter(
        (message) => message.role === "user",
      ).length;
      if (
        committedUserCount > pending.baselineUserCount ||
        (pending.accepted &&
          chatLegacyOf(conversationSnapshot).turnEnds.size >
            pending.baselineTurnEnds)
      ) {
        this.pendingSubmission = undefined;
        // The first projection was intentionally busy while the optimistic
        // row existed. Recompute once so the same notification can restore
        // ready/sendable state when that row is retired.
        projected = projectBoundSessionState({
          ...projectionInput,
          admissionPending: this.admissionPending,
        });
      }
    }
    this.state = {
      ...projected,
      pendingMessage: this.pendingSubmission?.message ?? null,
    };
    this.emit();
  }

  /**
   * The messages the Host has accepted for the agent's next turn. They arrive
   * through the session's Inbox projection rather than the snapshot the queue
   * strip used to read: `rc.2` moved pending input onto the projection surface,
   * and a key the Host never published reads as no queued work.
   */
  private queuedMessages(): readonly UserMessage[] {
    const inbox = this.session?.projections.faceOf("inbox").getSnapshot() as
      { readonly "next-turn"?: readonly UserMessage[] } | undefined;
    return inbox?.["next-turn"] ?? [];
  }

  /**
   * Record the submissions this binding has seen the Host name — the queue rows
   * it holds and the durable input rows it has written. Naming the message is the
   * server's own receipt for it, so from that notification on the row belongs to
   * the chat, not to the transport: an echo the claim leaves behind must not read
   * again as a question still crossing. The scan is only paid for while some
   * queued echo still waits for its name.
   *
   * Both lists are read because neither is reliable alone, and the transcript is
   * the durable one: a send admitted and claimed between two notifications never
   * appears in a queue frame this browser is handed, but its row stays in the
   * transcript, so the next frame names it. And the receipt is never dropped
   * while the binding lives — an id the server has named belongs to the submission
   * that minted it (`beginSubmission` returns a fresh `randomUUID`), so no later
   * send can need the row this hides, whereas forgetting the receipt re-draws the
   * ghost the moment the snapshot registers the echo again.
   *
   * Read from the notification, not from the projected frame: the projection of a
   * running turn is spaced, and an absorbed frame is dropped rather than
   * replayed, so spacing must not decide whether this browser ever saw the name.
   */
  private trackAdmittedSubmissions(): void {
    const snapshot = this.session?.getSnapshot();
    if (snapshot === undefined) return;
    // Only an echo still waiting can draw a row, so a chat whose queued sends are
    // all settled costs no scan of the transcript — and a browser registers the
    // echo before it sends, so an id with no echo there has nothing to settle.
    const unsettled = snapshot.pendingSubmissions.some(
      (item) =>
        item.placement === "queued" &&
        !this.admittedSubmissions.has(String(item.requestId)),
    );
    if (!unsettled) return;
    for (const requestId of hostNamedSubmissionIds(
      this.queuedMessages(),
      this.conversationBinding?.snapshot.getSnapshot(),
    )) {
      this.admittedSubmissions.add(requestId);
    }
  }

  /**
   * The directory the transcript's source paths are anchored on: the chat's
   * own cwd, never the configured pin while the chat is known.
   *
   * The Host records and previews sources anchored on the session's own cwd,
   * so the projection has to use that same directory. Anchoring it on
   * `session.cwd` puts a second spelling of the same file into the rail the
   * moment the two differ — an adopted chat, a chat created under an older
   * configuration — and the preview then refuses, as no longer evidence, a
   * source the answer just cited: the path it was asked for is not the path
   * the Host holds. The configured pin remains the fallback for a chat the
   * browser's list does not carry yet.
   */
  private sourceAnchor(sessionId: string): string | undefined {
    const list = this.sessions.list.getSnapshot();
    // `hasOwn`, not a plain read: the list is keyed by ids that reach us from
    // the Host and from browser storage, and `__proto__` must not resolve.
    const summary = Object.hasOwn(list.byId, sessionId)
      ? list.byId[sessionId as SessionId]
      : undefined;
    return sourceAnchorRoot(summary?.cwd, this.config.session.cwd);
  }

  /**
   * Display names of the known subagent sessions keyed by session id, for
   * settlement notices to sign with. The durable catalogs carry each
   * delegation's description verbatim; a child the host listed without a
   * catalog falls back to its own list title. Tolerates a host bundle older
   * than either field: an absent snapshot piece just contributes no names.
   *
   * Only the chats this page lists contribute: the host list is the whole
   * deployment's, so an unfiltered read would hand another account's
   * delegation into this browser — and a notice signed with a name that is
   * not the chat's own is exactly the leak the chat list itself is scoped
   * against.
   */
  private subagentNames(): Record<string, string> {
    const names: Record<string, string> = {};
    const list = this.sessions.list.getSnapshot();
    const chats = this.visibleChatIds();
    const candidates = visibleSubagentCandidates(list.byId ?? {}, chats);
    for (const candidate of candidates) {
      const name = readableSubagentName(candidate.label, candidate.id);
      if (name !== undefined) names[candidate.id] = name;
    }
    return names;
  }

  /**
   * The chats this page may show and name: the account's owned list while
   * accounts are on, and `undefined` — every chat on the Host — for a
   * deployment without accounts, where the list is the browser's own.
   */
  private visibleChatIds(): ReadonlySet<string> | undefined {
    if (this.accounts === undefined) return undefined;
    return new Set(this.accounts.ownedIds());
  }

  /**
   * Tell the user that a submission they pressed did not go. The composer keeps
   * its text through a refused send, so silence here would read as success.
   */
  private refuseSend(message: string): void {
    this.operationError = message;
    this.publish();
  }

  private fail(message: string, error: unknown): void {
    // Policy attestation refusals already logged their precise reason; a
    // second stack trace for the wrapper error is only console noise.
    if (!(error instanceof QaPolicyAttestationError)) {
      console.error("dsh-qa-surface: session operation failed", error);
    }
    if (this.disposed) return;
    this.operationError = message;
    this.state = {
      ...QA_SESSION_IDLE_STATE,
      chatKey: this.chatKey,
      phase: "error",
      error: message,
      chatsRevision: this.chatsRevision,
    };
    this.emit();
  }

  /**
   * Attest `session`, which defaults to the one currently bound. `ok` carries
   * the session id the proof was issued for; `stale` means the binding changed
   * while the request was in flight, so nothing was written — the newer binding
   * manages its own attestation; `refused` is a genuine admission refusal of
   * this binding.
   */
  private async attestPolicy(
    reportFailure = true,
    session = this.session,
  ): Promise<
    | { kind: "ok"; sessionId: string }
    | { kind: "refused"; reason: string | null }
    | { kind: "stale" }
  > {
    if (session === undefined) return { kind: "refused", reason: null };
    const sessionId = String(session.sessionId);
    if (!this.config.lockdown.enabled && this.accounts === undefined) {
      this.policyReady = true;
      return { kind: "ok", sessionId };
    }
    // With lockdown off there is no policy to pin, but the Host call still
    // runs: account identity and ownership are admitted there independently of
    // lockdown, and skipping the call is what let a browser that restored
    // another account's chat write into it without ever being asked who spoke.
    this.policyReady = false;
    this.publish();
    const outcome = await attestQaPolicy({
      secureSession: this.secureSessionRemote,
      token: this.accounts?.token() ?? "",
      sessionId,
      lockdown: this.config.lockdown,
      report: reportFailure,
    });
    if (this.session !== session) return { kind: "stale" };
    if (outcome.ok) {
      this.policyReady = true;
      this.operationError = null;
      this.publish();
      return { kind: "ok", sessionId };
    }
    if (outcome.authRequired) {
      // The identity expired or was rotated: back to the gate instead of
      // the generic configuration error.
      this.accounts?.onAuthRequired();
      return { kind: "refused", reason: outcome.reason };
    }
    this.policyReady = false;
    this.operationError = CONFIGURATION_ERROR;
    this.publish();
    return { kind: "refused", reason: outcome.reason };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Answer a request the Host parked for this chat. The Host re-checks the
   * request against the chat, so an answer that lost its race is a no-op; the
   * refresh that follows is what the surface renders.
   */
  async answerApproval(
    requestId: string,
    decision: QaApprovalDecision,
  ): Promise<void> {
    if (this.session === undefined || this.compatibilityReadOnly) return;
    await this.hostApprovals.answer(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
      decision,
    );
    this.publish();
  }

  /** Send the operator's answers to one parked question request. */
  async answerQuestion(
    requestId: string,
    answers: readonly QaQuestionAnswerItem[],
  ): Promise<void> {
    if (this.session === undefined || this.compatibilityReadOnly) return;
    await this.hostQuestions.answer(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
      answers,
    );
    this.publish();
  }

  /** Close a parked question request without answering it. */
  async cancelQuestion(requestId: string): Promise<void> {
    if (this.session === undefined || this.compatibilityReadOnly) return;
    await this.hostQuestions.cancel(
      String(this.session.sessionId),
      this.hostToken(),
      requestId,
    );
    this.publish();
  }

  /**
   * Poll the Host for parked requests while a turn runs. A request only exists
   * inside an open turn, and it is Host state: polling is how the page learns
   * about it, and how it reappears after a reload. One timer serves both seams,
   * and each is polled only where the deployment answers it.
   *
   * A request that is already on screen keeps the timer alive past the end of
   * its turn: the Host settles what the turn can no longer answer — an aborted
   * tool call, an agent that went idle — and this keeps reading until that
   * settlement reaches the page, so the form goes away instead of sitting
   * there answerable but dead.
   */
  private syncPendingPolling(running: boolean): void {
    const approvals = this.hostApprovals.available
      ? this.config.interaction.approvals === "interactive"
      : false;
    const questions = this.hostQuestions.available
      ? this.config.interaction.questions === "interactive"
      : false;
    const pending =
      this.hostApprovals.list().length > 0 ||
      this.hostQuestions.list().length > 0;
    const wanted =
      ((running && (approvals || questions)) || pending) &&
      // A subagent watched from the panel is a read-only view of a session the
      // chat owns: its own requests belong to the chat, not to this binding.
      this.viewingSubagent === null &&
      this.session !== undefined;
    if (!wanted) {
      this.stopPendingPolling();
      return;
    }
    if (this.pendingTimer !== undefined || this.session === undefined) return;
    const sessionId = String(this.session.sessionId);
    const token = this.hostToken();
    const tick = () => {
      // A seam still on screen is re-read even where its config gate has since
      // closed: the Host is the authority on what it holds, and an empty answer
      // is what takes a settled request off the screen.
      if (approvals || this.hostApprovals.list().length > 0) {
        void this.hostApprovals.refresh(sessionId, token, () => this.publish());
      }
      if (questions || this.hostQuestions.list().length > 0) {
        void this.hostQuestions.refresh(sessionId, token, () => this.publish());
      }
    };
    this.pendingTimer = setInterval(tick, PENDING_POLL_MS);
    tick();
  }

  /**
   * Read what the Host parks once per chat and connection, whether or not a
   * turn is running. A reload binds the chat before any turn reports itself
   * over the fresh stream, and a turn that is already waiting on a question
   * would otherwise sit behind an empty composer until the operator happened
   * to send something.
   */
  private probePending(sessionId: string, connected: boolean): void {
    const key = `${sessionId}:${connected ? "up" : "down"}:${String(this.policyReady)}`;
    // Attestation is what lets the Host answer about this chat at all, so the
    // read waits for it: the publish that follows a successful attestation
    // carries a new key and probes then.
    if (!connected || !this.policyReady || key === this.pendingProbeKey) return;
    this.pendingProbeKey = key;
    const token = this.hostToken();
    if (
      this.hostApprovals.available &&
      this.config.interaction.approvals === "interactive"
    ) {
      void this.hostApprovals.refresh(sessionId, token, () => this.publish());
    }
    if (
      this.hostQuestions.available &&
      this.config.interaction.questions === "interactive"
    ) {
      void this.hostQuestions.refresh(sessionId, token, () => this.publish());
    }
  }

  private stopPendingPolling(): void {
    if (this.pendingTimer === undefined) return;
    clearInterval(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  private hostToken(): string {
    return this.accounts?.token() ?? "";
  }
}
