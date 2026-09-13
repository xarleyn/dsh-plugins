import type { QaTurnSources } from "./provenance/types.js";

export type QaSessionPolicy = "browser-persistent" | "new-on-load" | "fixed";
export type QaSandboxMode = "read-only" | "workspace-write";
export type QaApprovalPolicy = "never";
export type QaToolPolicyMode = "allow-list";
export type QaAccountRole = "user" | "admin";

/** The account fields projected to browsers; never includes credentials. */
export interface QaAccountUserPublic {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: QaAccountRole;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
  readonly disabled: boolean;
  /** Self-declared identity the QA prompt renders; empty until edited. */
  readonly profile: QaAccountProfile;
}

/** One external system the deployment collects a handle for. */
export interface QaAccountIdentityField {
  /** Stable lowercase key: the profile's storage key and the prompt's label. */
  readonly key: string;
  /** Operator copy shown in the profile form. */
  readonly label: string;
}

/**
 * What one account says about itself. Every value is the owner's own wording,
 * which is why the prompt renders it as self-declared rather than as a
 * verified directory attribute.
 */
export interface QaAccountProfile {
  /** Full name as the user writes it; empty when unset. */
  readonly fullName: string;
  /** External-system handles, keyed by the declared field key. */
  readonly identities: Readonly<Record<string, string>>;
  /** Free-form guidance about how the user wants answers; empty when unset. */
  readonly instructions: string;
  /** ISO timestamp of the last edit; null while the profile is untouched. */
  readonly updatedAt: string | null;
}

/** Full-replace profile write: an absent value clears the stored one. */
export interface QaAccountProfileInput {
  readonly fullName: string;
  readonly identities: Readonly<Record<string, string>>;
  readonly instructions: string;
}

/** One successful login/registration: the bearer token plus the user. */
export interface QaAccountSession {
  readonly token: string;
  readonly user: QaAccountUserPublic;
}

export type QaWhoamiResult =
  | { readonly authenticated: false }
  | { readonly authenticated: true; readonly user: QaAccountUserPublic };

/** Bulk ownership claim outcome for one browser's local chat index. */
export interface QaClaimResult {
  readonly claimed: number;
  /** Ids already owned by a different user; the browser drops them. */
  readonly conflicts: readonly string[];
}

/**
 * One chat-ownership entry as the admin views see it: the session, its owner
 * and the owner's display name resolved at read time (a disabled account
 * still names its chats).
 */
export interface QaOwnershipEntry {
  readonly sessionId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly claimedAt: string;
}

export interface QaSourcesConfig {
  readonly enabled?: boolean;
  readonly collect?: {
    readonly parentAgent?: boolean;
    readonly subagents?: boolean;
    readonly persistTurnEvent?: boolean;
  };
  readonly display?: {
    readonly sidebar?: boolean;
    readonly footer?: boolean;
    readonly groupByKind?: boolean;
    readonly showDiscovered?: boolean;
    readonly showOriginBadges?: boolean;
    readonly maxInitiallyVisiblePerGroup?: number;
  };
  readonly webSearch?: {
    readonly promoteSearchResultsWithoutFetch?: boolean;
    readonly maxPromotedPerSearch?: number;
  };
  readonly dedupe?: {
    readonly normalizeUrls?: boolean;
    readonly stripTrackingParams?: boolean;
    readonly mergeFileRanges?: boolean;
  };
  readonly filePreview?: {
    readonly enabled?: boolean;
    readonly markdownRenderedByDefault?: boolean;
    readonly allowRawToggle?: boolean;
    readonly maxBytes?: number;
    readonly maxMarkdownRenderBytes?: number;
  };
  readonly subagents?: {
    readonly inheritSources?: boolean;
    readonly enableReportToolFallback?: boolean;
    readonly markIncompleteOpaqueRuns?: boolean;
  };
  readonly legacy?: {
    readonly parseAssistantSourcesBlock?: boolean;
  };
}

export interface QaSurfaceConfig {
  readonly enabled?: boolean;
  readonly route?: {
    readonly path?: string;
    readonly matchChildren?: boolean;
  };
  readonly branding?: {
    readonly title?: string;
    readonly subtitle?: string;
    readonly welcomeMessage?: string;
    readonly placeholder?: string;
    readonly logoUrl?: string | null;
    /** Data-usage notice under the composer; empty string hides the plate. */
    readonly disclaimer?: string | null;
  };
  readonly session?: {
    readonly policy?: QaSessionPolicy;
    readonly storageKey?: string;
    /** Absolute directory pinned as the session cwd (alternative to workspaceId). */
    readonly cwd?: string | null;
    readonly workspaceId?: string | null;
    readonly fixedSessionId?: string | null;
    readonly agentPreset?: string | null;
    readonly provider?: string | null;
    readonly model?: string | null;
    readonly reasoningEffort?: string | null;
  };
  readonly ui?: {
    readonly showHeader?: boolean;
    readonly showReset?: boolean;
    readonly showStop?: boolean;
    readonly showTimestamps?: boolean;
    readonly showToolActivity?: boolean;
    readonly showReasoning?: boolean;
    readonly renderMarkdown?: boolean;
    readonly maxContentWidth?: number;
    readonly showSessionList?: boolean;
  };
  readonly suggestedQuestions?: readonly string[];
  /**
   * Phrases the running indicator cycles through. An empty list restores the
   * built-in phrases: the indicator always carries a label.
   */
  readonly thinkingPhrases?: readonly string[];
  readonly interaction?: {
    readonly approvals?: "blocked";
    readonly questions?: "unsupported";
  };
  readonly lockdown?: {
    readonly enabled?: boolean;
    readonly enforceFixedAgentPreset?: boolean;
    readonly enforceFixedWorkspace?: boolean;
    readonly enforceFixedModel?: boolean;
    readonly sandboxMode?: QaSandboxMode;
    readonly approvalPolicy?: QaApprovalPolicy;
    readonly permissionPreset?: string;
    readonly allowPermissionChanges?: false;
    readonly allowSlashCommands?: false;
    readonly allowSettingsMutation?: false;
    readonly allowSessionReset?: boolean;
    readonly allowSessionRename?: false;
    readonly allowSessionDelete?: false;
    readonly allowArbitrarySessionOpen?: false;
    readonly toolPolicy?: {
      readonly mode?: QaToolPolicyMode;
      readonly allow?: readonly string[];
    };
  };
  readonly embedding?: {
    readonly frameAncestors?: string | null;
  };
  readonly accounts?: {
    /** Opt-in; the QA gate stays off until the deployment turns this on. */
    readonly enabled?: boolean;
    readonly allowRegistration?: boolean;
    readonly sessionTtlDays?: number;
    /** Let admins see chats owned by other QA accounts. */
    readonly showOtherUsersChats?: boolean;
    /**
     * Give every account a private cwd below the configured workspaceId.
     * The child directory is not registered as a separate DSH workspace.
     */
    readonly perUserWorkspace?: boolean;
    /** Self-declared profile: storage, the owner's form, and prompt injection. */
    readonly profile?: {
      readonly enabled?: boolean;
      /** Render the profile into the QA agent's system prompt. */
      readonly inject?: boolean;
      /** External systems to collect a handle for; empty declares none. */
      readonly identities?: readonly {
        readonly key?: string;
        readonly label?: string;
      }[];
      /** Character cap on the user's free-form agent guidance. */
      readonly instructionsMaxLength?: number;
    };
  };
  readonly entry?: {
    /** Inject the root → /qa redirect for non-loopback hostnames. */
    readonly redirectNonLoopback?: boolean;
    /** Cookie-less /qa navigations go through the one-time ?token= exchange. */
    readonly cookieBootstrap?: boolean;
  };
  readonly sources?: QaSourcesConfig;
  readonly attachments?: QaAttachmentsConfig;
}

/** What a QA visitor may attach to one message. */
export interface QaAttachmentsConfig {
  /** Offer text files (md, txt, log, …) next to images; off = images only. */
  readonly textFiles?: boolean;
  /**
   * Line count above which pasted plain text becomes an attached file instead
   * of landing in the input field. Zero never converts.
   */
  readonly pastedTextLines?: number;
  /** Byte ceiling for one attached file; the composer refuses anything larger. */
  readonly maxFileBytes?: number;
  /**
   * Pending attachments (images plus text files) allowed on one message. The
   * Host keeps its own authority over assembled image batches.
   */
  readonly maxPending?: number;
  /** Accepted text-file extensions, lowercase and without the dot. */
  readonly extensions?: readonly string[];
}

export interface ResolvedQaSurfaceConfig {
  readonly enabled: boolean;
  readonly route: {
    readonly path: string;
    readonly matchChildren: boolean;
  };
  readonly branding: {
    readonly title: string;
    readonly subtitle: string;
    readonly welcomeMessage: string;
    readonly placeholder: string;
    readonly logoUrl: string | null;
    readonly disclaimer: string;
  };
  readonly session: {
    readonly policy: QaSessionPolicy;
    readonly storageKey: string;
    readonly cwd: string | null;
    readonly workspaceId: string | null;
    readonly fixedSessionId: string | null;
    readonly agentPreset: string | null;
    readonly provider: string | null;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
  };
  readonly ui: {
    readonly showHeader: boolean;
    readonly showReset: boolean;
    readonly showStop: boolean;
    readonly showTimestamps: boolean;
    readonly showToolActivity: boolean;
    readonly showReasoning: boolean;
    readonly renderMarkdown: boolean;
    readonly maxContentWidth: number;
    readonly showSessionList: boolean;
  };
  readonly suggestedQuestions: readonly string[];
  readonly thinkingPhrases: readonly string[];
  readonly interaction: {
    readonly approvals: "blocked";
    readonly questions: "unsupported";
  };
  readonly lockdown: {
    readonly enabled: boolean;
    readonly enforceFixedAgentPreset: boolean;
    readonly enforceFixedWorkspace: boolean;
    readonly enforceFixedModel: boolean;
    readonly sandboxMode: QaSandboxMode;
    readonly approvalPolicy: QaApprovalPolicy;
    readonly permissionPreset: string;
    readonly allowPermissionChanges: false;
    readonly allowSlashCommands: false;
    readonly allowSettingsMutation: false;
    readonly allowSessionReset: boolean;
    readonly allowSessionRename: false;
    readonly allowSessionDelete: false;
    readonly allowArbitrarySessionOpen: false;
    readonly toolPolicy: {
      readonly mode: QaToolPolicyMode;
      readonly allow: readonly string[];
    };
  };
  readonly embedding: {
    readonly frameAncestors: string | null;
  };
  readonly accounts: {
    readonly enabled: boolean;
    readonly allowRegistration: boolean;
    readonly sessionTtlDays: number;
    readonly showOtherUsersChats: boolean;
    readonly perUserWorkspace: boolean;
    readonly profile: {
      readonly enabled: boolean;
      readonly inject: boolean;
      readonly identities: readonly QaAccountIdentityField[];
      readonly instructionsMaxLength: number;
    };
  };
  readonly entry: {
    readonly redirectNonLoopback: boolean;
    readonly cookieBootstrap: boolean;
  };
  readonly sources: {
    readonly enabled: boolean;
    readonly collect: {
      readonly parentAgent: boolean;
      readonly subagents: boolean;
      readonly persistTurnEvent: boolean;
    };
    readonly display: {
      readonly sidebar: boolean;
      readonly footer: boolean;
      readonly groupByKind: boolean;
      readonly showDiscovered: boolean;
      readonly showOriginBadges: boolean;
      readonly maxInitiallyVisiblePerGroup: number;
    };
    readonly webSearch: {
      readonly promoteSearchResultsWithoutFetch: boolean;
      readonly maxPromotedPerSearch: number;
    };
    readonly dedupe: {
      readonly normalizeUrls: boolean;
      readonly stripTrackingParams: boolean;
      readonly mergeFileRanges: boolean;
    };
    readonly filePreview: {
      readonly enabled: boolean;
      readonly markdownRenderedByDefault: boolean;
      readonly allowRawToggle: boolean;
      readonly maxBytes: number;
      readonly maxMarkdownRenderBytes: number;
    };
    readonly subagents: {
      readonly inheritSources: boolean;
      readonly enableReportToolFallback: boolean;
      readonly markIncompleteOpaqueRuns: boolean;
    };
    readonly legacy: {
      readonly parseAssistantSourcesBlock: boolean;
    };
  };
  readonly attachments: {
    readonly textFiles: boolean;
    readonly pastedTextLines: number;
    readonly maxFileBytes: number;
    readonly maxPending: number;
    readonly extensions: readonly string[];
  };
}

export interface QaSourceFilePreview {
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly truncated: boolean;
  readonly markdown: boolean;
  readonly renderableMarkdown: boolean;
}

/** Host-attested facts required before the QA composer may become writable. */
export interface QaLockdownProof {
  readonly sessionId: string;
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

export type QaMessage =
  | {
      readonly id: string;
      readonly role: "user";
      readonly text: string;
      readonly status: "committed";
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
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly text: string;
      readonly status: "streaming" | "committed" | "failed";
      readonly timestamp?: number;
      /** Host turn this answer belongs to; groups regenerations into variants. */
      readonly turn?: number;
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
      /** Collapsible settlement row (subagent finished/stopped/failed). */
      readonly notice?: {
        readonly title: string;
        readonly body: string;
      };
    }
  | {
      readonly id: string;
      readonly role: "work";
      readonly turn: number;
      /** "error" marks a turn the host ended with a provider failure. */
      readonly status: "running" | "complete" | "error";
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

export type {
  QaSourceEvidence,
  QaSourceKind,
  QaSourceLocation,
  QaSourceOrigin,
  QaSourceReference,
  QaTurnSources,
} from "./provenance/types.js";

/** Transitional UI name; the drawer now consumes the canonical source object. */
export type QaSource = import("./provenance/types.js").QaSourceReference;

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

export interface QaSessionState {
  readonly phase: QaSessionPhase;
  readonly sessionId: string | null;
  readonly messages: readonly QaMessage[];
  readonly error: string | null;
  readonly canSend: boolean;
  readonly canStop: boolean;
  /** Bumped whenever this browser's chat index changes (add/forget). */
  readonly chatsRevision: number;
  /** Tool-derived sources of the current chat (web targets and files read). */
  readonly sources: readonly QaSource[];
  readonly sourcesComplete: boolean;
  readonly incompleteSourceOrigins: QaTurnSources["incompleteOrigins"];
  /** Set while the bound session is a subagent watched from the panel. */
  readonly viewingSubagent: QaSubagentView | null;
}
