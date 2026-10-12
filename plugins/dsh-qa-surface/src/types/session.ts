import type { QaTurnSources } from "../provenance/types.js";
import type { QaArtifactView } from "./documents.js";
import type { QaCommandActivity, QaSlashView } from "./slash.js";

export interface QaSourceFilePreview {
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly truncated: boolean;
  readonly markdown: boolean;
  readonly renderableMarkdown: boolean;
  readonly document?: QaDocumentPreview;
  readonly frontmatter?: import("../markdown-frontmatter.js").MarkdownFrontmatter;
}

/**
 * A file the panel renders by conversion rather than by bytes: the document
 * pipeline turned a Word file into PDF, and the browser shows that PDF.
 */
export interface QaDocumentPreview {
  readonly kind: "pdf";
  readonly base64: string;
  readonly mime: "application/pdf";
  readonly name: string;
  readonly bytes: number;
}

/** One directory entry of a chat's own workspace, as the files panel browses it. */
export interface QaWorkspaceEntry {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size: number | null;
}

/**
 * One directory of the chat's workspace. `path` is the canonical form of the
 * directory as requested — the chat root itself is the empty string — so the
 * panel can build a breadcrumb without another round trip.
 */
export interface QaWorkspaceListing {
  readonly path: string;
  readonly entries: readonly QaWorkspaceEntry[];
  /** More children existed than one listing carries. */
  readonly truncated: boolean;
}

/**
 * One file of the chat's workspace: decoded text when it reads as UTF-8, base64
 * bytes when it does not. The panel needs both — documents the agent produced
 * are binary, while notes and transcripts preview as text.
 */
export interface QaWorkspaceFileChunk {
  readonly path: string;
  readonly size: number;
  readonly offset: number;
  readonly version: string;
  readonly base64: string;
  readonly done: boolean;
}

export interface QaWorkspaceFile {
  readonly path: string;
  readonly size: number;
  readonly truncated: boolean;
  readonly markdown: boolean;
  readonly renderableMarkdown: boolean;
  readonly mime: string;
  /** Present when the file decoded as text; absent for binary content. */
  readonly text?: string;
  /** Present when the file is not text; base64 of at most the byte cap. */
  readonly base64?: string;
}

/** Host-attested facts required before the QA composer may become writable. */
export interface QaLockdownProof {
  readonly chatAccess?: import("../chat-sharing/types.js").QaChatAccess;
  readonly sessionId: string;
  /** Last inherited event in an ordinary fork; absent on an original chat. */
  readonly inheritedThroughSeq?: number;
  readonly enabled: boolean;
  readonly agentPresetMatches: boolean;
  readonly workspaceMatches: boolean;
  readonly modelMatches: boolean;
  readonly sandboxModeMatches: boolean;
  readonly approvalIsNever: boolean;
  readonly permissionPreset: string;
  readonly toolPolicyLoaded: boolean;
  readonly toolAllowList: readonly string[];
}

export interface QaUserMessage {
  readonly id: string;
  readonly role: "user";
  readonly text: string;
  /** `pending` is a browser-only optimistic row until the Host emits it. */
  readonly status: "pending" | "committed";
  readonly timestamp?: number;
  readonly images?: readonly QaImageView[];
  /** Durable files the user attached to this message, in prompt order. */
  readonly files?: readonly QaFileView[];
  /**
   * Chat owner's display name, set only for an admin reading a foreign
   * chat; the owner themself sees their messages unlabeled.
   */
  readonly author?: string;
}

/** Browser-only user row shown while the Host prepares the accepted turn. */
export type QaPendingUserMessage = Omit<QaUserMessage, "status"> & {
  readonly status: "pending";
};

export type QaMessage =
  | QaUserMessage
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly text: string;
      readonly status: "streaming" | "committed" | "failed";
      readonly timestamp?: number;
      /**
       * Position of this answer in the session's durable event log. Feedback is
       * keyed to it: a rating survives a replay, a reload and a role change,
       * while the browser's own message id does not.
       */
      readonly seq?: number;
      /** Final text of a completed turn with a durable fork boundary. */
      readonly forkable?: boolean;
      /** Host turn this answer belongs to; groups regenerations into variants. */
      readonly turn?: number;
      /**
       * Files this turn produced, in the order the tools reported them. The
       * answer is the place a produced document is handed over: without these
       * cards the file exists only as a path in a paragraph, and a reader who
       * does not know the files tab concludes nothing was made.
       */
      readonly artifacts?: readonly QaArtifactView[];
      /** Canonical evidence snapshot shared with this answer's source drawer. */
      readonly sources?: readonly QaSource[];
      readonly sourcesComplete?: boolean;
      readonly incompleteSourceOrigins?: QaTurnSources["incompleteOrigins"];
      /** Host-recorded response timing, present on finalized messages only. */
      readonly stats?: {
        /** step start → final message. */
        readonly durationMs: number;
        /** step start → first token; null when no token delta was recorded. */
        readonly ttftMs: number | null;
        /** Estimated from visible text (≈4 chars/token) over the generation window. */
        readonly tokensPerSecond: number | null;
      };
    }
  | {
      readonly id: string;
      readonly role: "system";
      readonly text: string;
      readonly status: "info" | "error";
      readonly timestamp?: number;
      /**
       * Set on a human command row. Commands stay out of the model
       * conversation, so this projection is the only trace the user sees.
       */
      readonly command?: QaCommandActivity;
      /** Collapsible settlement row (subagent finished/stopped/failed). */
      readonly notice?: {
        readonly title: string;
        readonly body: string;
        /** Muted correlation line above the body (task name, session id). */
        readonly meta?: string;
      };
    }
  | {
      readonly id: string;
      readonly role: "work";
      readonly turn: number;
      /**
       * "error" marks a turn the host ended with a provider failure; "stopped"
       * marks one the user ended, whose answer is a prefix rather than a reply.
       */
      readonly status: "running" | "complete" | "error" | "stopped";
      readonly startedAt?: number;
      readonly endedAt?: number;
      readonly items: readonly QaWorkItem[];
    };

export type QaWorkItem =
  | {
      readonly id: string;
      readonly kind: "reasoning" | "progress";
      readonly text: string;
      readonly status: "running" | "complete";
    }
  | {
      readonly id: string;
      readonly kind: "tool";
      readonly name: string;
      readonly label: string;
      readonly summary: string;
      readonly input: string | null;
      readonly output: string | null;
      readonly status: "running" | "ok" | "error" | "stopped";
      /** Durable child id, present on subagent launch calls that started one. */
      readonly subagentId?: string;
      readonly startedAt?: number;
      readonly endedAt?: number;
    };

export type QaSessionPhase =
  | "idle"
  | "creating"
  | "ready"
  | "running"
  | "reconnecting"
  | "blocked"
  | "error";

/** Transitional UI name; the drawer now consumes the canonical source object. */
export type QaSource = import("../provenance/types.js").QaSourceReference;

/** Raster formats the attachment path accepts (mirrors the host contract). */
export type QaImageMediaType =
  "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** One image pending in the composer, browser-owned until the prompt lands. */
export interface QaImageDraft {
  readonly kind: "image";
  readonly id: string;
  readonly mediaType: QaImageMediaType;
  readonly name: string;
  /** Canonical base64 of the image bytes, without the data: URL prefix. */
  readonly data: string;
  /** Local object URL for the preview thumbnail. */
  readonly previewUrl: string;
}

/**
 * One file pending in the composer. The bytes stay in the browser until the
 * prompt is sent: an image can ride the prompt inline, but a file must be
 * staged through the Host upload route first and then cited by its receipt.
 */
export interface QaFileDraft {
  readonly kind: "file";
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  /** Verbatim payload; a pasted blob is a File built from the pasted text. */
  readonly blob: Blob;
}

/** Anything the composer may hold before the prompt is sent. */
export type QaAttachmentDraft = QaImageDraft | QaFileDraft;

/** A durable image attached to a sent message. */
export interface QaImageView {
  readonly attachmentId: string;
  readonly mediaType: QaImageMediaType;
  /** Browser-local thumbnail URL, present only on an optimistic message. */
  readonly previewUrl?: string;
}

/**
 * A durable file attached to a sent message. The browser never reads these
 * bytes back (the attachment route serves images); the row shows the handle
 * the model resolves, and the Host keeps the verbatim copy.
 */
export interface QaFileView {
  readonly attachmentId: string;
  readonly name: string;
  readonly bytes: number;
}

/** A subagent transcript opened read-only from the agents panel. */
export interface QaSubagentView {
  readonly id: string;
  readonly title: string;
}

/**
 * One tool call waiting for the operator. The browser lists these over its own
 * remote and answers them one by one; nothing here is answered automatically.
 */
export interface QaPendingApproval {
  readonly id: string;
  /** The chat the request belongs to: a delegated child asks under its root. */
  readonly sessionId: string;
  readonly toolName: string;
  /** The reason the composed gate gave for asking, when it gave one. */
  readonly reason: string | null;
  readonly createdAt: number;
  /** True when a delegated child of the chat made the call. */
  readonly delegated: boolean;
}

/**
 * One question waiting for the operator, normalized for the form the QA view
 * renders. The protocol fields are the harness user-questions contract; absent
 * ones become explicit nulls so the browser never branches on undefined.
 */
export interface QaPendingQuestionItem {
  readonly id: string;
  readonly question: string;
  readonly header: string | null;
  readonly detail: string | null;
  readonly options: readonly QaPendingQuestionOption[];
  readonly multiSelect: boolean;
}

export interface QaPendingQuestionOption {
  readonly label: string;
  readonly description: string | null;
}

/**
 * One user-questions request parked for the operator. A single request carries
 * every question the model asked in one call, so the card is a form with a
 * pager, not a list of independent prompts.
 */
export interface QaPendingQuestion {
  readonly id: string;
  /** The chat the request belongs to. */
  readonly sessionId: string;
  readonly questions: readonly QaPendingQuestionItem[];
  readonly createdAt: number;
}

/**
 * One message that waits for the agent's next turn. Rows the Host already
 * admitted carry their durable occurrence id, which is what a queue operation
 * addresses; a row still in flight carries a browser id and edits nothing.
 */
export interface QaQueueRow {
  readonly id: string;
  /** Short single-line text for the strip; newlines are folded away. */
  readonly preview: string;
  /** Full text to edit, or null when the row is not plain text. */
  readonly text: string | null;
  /** Attachments the row carries besides its text. */
  readonly attachments: number;
  /** Set for a local row the Host queue has not echoed back yet. */
  readonly sending: boolean;
}

/** What the queue strip may ask the Host to do with one waiting message. */
export type QaQueueOperation = "edit" | "remove" | "steer";

/**
 * What `qaSurface/queueStatus` answers: how much of the deployment's request
 * ceiling is in use right now. The Host counts the chats whose agent is running
 * a turn, so the load is read where the whole of it is visible rather than
 * guessed from one browser's view of the stand.
 */
export interface QaQueueStatus {
  /** The configured ceiling; 0 means the deployment sets none. */
  readonly limit: number;
  /**
   * Turns answering at the moment of the read, this visitor's own included —
   * the stand cannot tell a place it owes someone from one it owes you.
   */
  readonly active: number;
  /** Whether one more turn fits; false while no ceiling is set. */
  readonly full: boolean;
}

export interface QaSessionState {
  readonly chatAccess?: import("../chat-sharing/types.js").QaChatAccess;
  readonly phase: QaSessionPhase;
  readonly sessionId: string | null;
  /**
   * Identity of the chat the surface is showing. Unique across every chat the
   * page has opened — a controller that is re-created for a new chat is handed
   * a new identity, so a component keyed by it cannot carry one chat's composer
   * text into another. It is taken only when the chat changes: a draft that
   * creates its session on the first prompt keeps its key, because the composer
   * holds an unsent question in component state, and remounting it on the new
   * session id would throw that text away before the Host has accepted
   * anything. `0` means no chat — see `QA_SESSION_IDLE_STATE`.
   */
  readonly chatKey: number;
  readonly messages: readonly QaMessage[];
  /** Immediate send feedback, kept outside the durable transcript. */
  readonly pendingMessage: QaPendingUserMessage | null;
  readonly error: string | null;
  /**
   * An owner-authorized historical chat whose recorded composition no longer
   * matches the deployment. Its transcript remains visible, but no Host
   * operation may be issued through this binding.
   */
  readonly compatibilityReadOnly?: boolean;
  readonly canSend: boolean;
  readonly canStop: boolean;
  /**
   * Messages waiting for the next turn, oldest first. Sending while the agent
   * runs lands here instead of in the transcript, so the strip beside the
   * composer is the only place the user can still see them.
   */
  readonly queue: readonly QaQueueRow[];
  /** Whether a queue operation may be issued on this binding right now. */
  readonly canEditQueue: boolean;
  /** Bumped whenever this browser's chat index changes (add/forget). */
  readonly chatsRevision: number;
  /** Tool-derived sources of the current chat (web targets and files read). */
  readonly sources: readonly QaSource[];
  readonly sourcesComplete: boolean;
  readonly incompleteSourceOrigins: QaTurnSources["incompleteOrigins"];
  /** Set while the bound session is a subagent watched from the panel. */
  readonly viewingSubagent: QaSubagentView | null;
  /** Tool calls parked for the operator's answer, oldest first. */
  readonly approvals: readonly QaPendingApproval[];
  /** Question requests parked for the operator's answer, oldest first. */
  readonly questions: readonly QaPendingQuestion[];
  /**
   * Set when a send was held back because the stand is already answering as
   * many questions as it allows. The question never left the browser, so this
   * is the whole of what the visitor is told about it; the surface answers with
   * the request-ceiling dialog and the composer keeps the draft. Named apart
   * from `queue`, which is the same chat's list of waiting messages.
   */
  readonly requestQueue: QaQueueStatus | null;
  /** Slash palette state, keyed to the chat this snapshot describes. */
  readonly slash: QaSlashView;
}

/** Minimal server-trusted identity exposed to principal-scoped plugins. */
export interface QaPrincipal {
  readonly userId: string;
}
