import type {
  QaDocumentsConfig,
  ResolvedQaDocumentsConfig,
} from "./documents/config.js";
import type { QaTurnSources } from "./provenance/types.js";

export type QaSessionPolicy = "browser-persistent" | "new-on-load" | "fixed";
export type QaSandboxMode = "read-only" | "workspace-write";
export type QaApprovalPolicy = "never";
export type QaToolPolicyMode = "allow-list";
/**
 * How the QA tool catalog is attached. `all` attaches the whole catalog once
 * the activation skill loads; the field is reserved so a future grouped or
 * searched mode needs no config redesign.
 */
export type QaToolActivationMode = "all";
/**
 * How a tool policy `ask` resolves on an attested QA agent. `blocked` refuses
 * the call with the surface's own reason; `interactive` parks it until the
 * operator answers in the QA view.
 */
export type QaApprovalInteraction = "blocked" | "interactive";
/**
 * How a user-questions request resolves on an attested QA agent. `unsupported`
 * refuses the ask outright; `interactive` answers it from the QA view.
 */
export type QaQuestionInteraction = "unsupported" | "interactive";
/** The operator's answer to one parked tool call. */
export type QaApprovalDecision = "allowed-once" | "rejected";
/** One answered question; `custom` is free text, and may accompany `selected`. */
export interface QaQuestionAnswerItem {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}
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
  /** The account's own starter buttons; empty until customized. */
  readonly starters: QaAccountStarters;
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

/** One starter button: what it reads and what pressing it sends. */
export interface QaAccountStarter {
  readonly label: string;
  readonly prompt: string;
}

/**
 * An account's own starter buttons plus the choice about the deployment's
 * built-in suggestions. Pure UI preferences: unlike the profile, none of this
 * reaches the agent prompt.
 */
export interface QaAccountStarters {
  readonly items: readonly QaAccountStarter[];
  /** Hide the deployment's suggested questions in this account's composer. */
  readonly hideDefaults: boolean;
}

/** Full-replace starters write: an absent value clears the stored one. */
export interface QaAccountStartersInput {
  readonly items: readonly QaAccountStarter[];
  readonly hideDefaults: boolean;
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

/**
 * Why one skill draft cannot be saved, or why it saves with a caveat. Codes
 * stay stable on the wire; the browser owns the Russian copy.
 */
export type QaSkillDiagnosticCode =
  | "name-required"
  | "name-invalid"
  | "name-mismatch"
  | "description-required"
  | "description-too-long"
  | "when-to-use-too-long"
  | "field-type-invalid"
  | "invocation-never"
  | "invocation-invalid"
  | "invocation-legacy-key"
  | "allowed-tools-invalid"
  | "tool-name-invalid"
  | "tool-unavailable"
  | "tools-too-many"
  | "file-too-large"
  | "frontmatter-missing"
  | "skill-file-missing"
  | "frontmatter-invalid"
  | "unknown-field"
  | "resource-unsupported";

/** One finding about a skill file or an editor draft. */
export interface QaSkillDiagnostic {
  readonly code: QaSkillDiagnosticCode;
  readonly severity: "error" | "warning";
  /** The editor field the message belongs to, or null for a file-wide one. */
  readonly field: string | null;
  /** The offending value: a tool name, a frontmatter key, a limit. */
  readonly detail: string | null;
}

/**
 * A JSON-representable frontmatter value. The editor receives the preserved
 * foreign fields verbatim over the Host bridge, which carries JSON only, so
 * the parser drops anything a YAML document can hold but JSON cannot.
 */
export type QaSkillJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly QaSkillJsonValue[]
  | { readonly [key: string]: QaSkillJsonValue };

/** One personal skill as the catalog list renders it. */
export interface QaSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  /** Declared tools, in canonical order; unknown ones included. */
  readonly allowedTools: readonly string[];
  /** Declared tools the current QA scope cannot use; still stored as declared. */
  readonly unavailableTools: readonly string[];
  /** Entries in the skill directory besides SKILL.md (references, assets, …). */
  readonly resourceCount: number;
  readonly valid: boolean;
  readonly diagnostics: readonly QaSkillDiagnostic[];
  readonly updatedAt: string | null;
  /** sha256 of the stored bytes; an update must echo the revision it read. */
  readonly revision: string;
}

/** One personal skill with everything the editor needs. */
export interface QaSkillDocument extends QaSkillSummary {
  readonly body: string;
  /** Frontmatter the editor preserves but does not own. */
  readonly extraFrontmatter: Readonly<Record<string, QaSkillJsonValue>>;
  /** Absolute SKILL.md path; rendered read-only for advanced users. */
  readonly sourcePath: string;
  /** The canonical file the serializer writes, built from the parsed content. */
  readonly preview: string;
}

/** One tool the picker can offer, with this deployment's availability. */
export interface QaSkillToolDescriptor {
  readonly name: string;
  readonly description: string;
  /** False when the QA session's own scope cannot use the tool. */
  readonly available: boolean;
}

/** The editor's save payload. */
export interface QaSkillDraftInput {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string | null;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly allowedTools: readonly string[];
  readonly body: string;
  /** Echo of the revision the editor read; a stale one is refused. */
  readonly expectedRevision: string | null;
}

/**
 * The Host's answer about one unsaved draft: the file a save would write and
 * the diagnostics it found. The editor shows its own subset immediately and
 * this authoritative set as soon as it arrives.
 */
export interface QaSkillValidation {
  readonly preview: string;
  readonly diagnostics: readonly QaSkillDiagnostic[];
}

/** What one delete did: v1 keeps the directory recoverable. */
export interface QaSkillRemoval {
  readonly name: string;
  readonly trashed: boolean;
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
    /**
     * Whether a source the model writes into `qa_report_sources` must carry a
     * usable path or URL. Off records the model's own type, title and snippet.
     */
    readonly validateReportedSources?: boolean;
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
    /** Floor for the visitor-resizable transcript/composer width; the page caps it. */
    readonly minContentWidth?: number;
    readonly showSessionList?: boolean;
    /**
     * Sign subagent completion notices with deterministic codenames
     * («Дотошный Барсук») instead of the child's readable name or raw id.
     */
    readonly subagentCodenames?: boolean;
  };
  readonly suggestedQuestions?: readonly string[];
  /**
   * Phrases the running indicator cycles through. An empty list restores the
   * built-in phrases: the indicator always carries a label.
   */
  readonly thinkingPhrases?: readonly string[];
  readonly interaction?: {
    readonly approvals?: QaApprovalInteraction;
    readonly questions?: QaQuestionInteraction;
  };
  /**
   * QA tool delivery. Dynamic activation keeps the QA tool schemas out of the
   * model request until the activation skill has actually been loaded.
   */
  readonly tools?: {
    /**
     * `true` attaches the QA tools only after the activation skill loads;
     * `false` attaches them to every managed agent at creation.
     */
    readonly dynamicActivation?: boolean;
    /** The skill name whose successful load attaches the QA tools. */
    readonly activationSkill?: string;
    /** Accepted activation policy; only `all` is implemented. */
    readonly activationMode?: QaToolActivationMode;
    /**
     * Agent presets whose sessions participate. An empty list leaves the gate
     * open, which is only safe when this plugin serves one agent composition —
     * name the QA preset in any deployment that composes more than one.
     */
    readonly activationPresets?: readonly string[];
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
    /** Shared directories available to read-only filesystem tools. */
    readonly sharedReadOnlyRoots?: readonly string[];
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
    /**
     * Personal Skills: the user's own `.dsh/skills` below their QA workspace,
     * surfaced through a skill provider this plugin owns.
     */
    readonly skills?: {
      readonly enabled?: boolean;
      /** Directory below the personal root; relative, never escaping it. */
      readonly relativeRoot?: string;
      /** Follow manual file edits and refresh the DSH catalog. */
      readonly watch?: boolean;
      readonly maxSkillBytes?: number;
      /** Reserved for the resource editor; v1 edits SKILL.md only. */
      readonly allowResourceEditing?: boolean;
    };
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
    /** Per-account starter buttons above an empty composer. */
    readonly starters?: {
      readonly enabled?: boolean;
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
  /** Document pipeline: creation, conversion and extraction (see documents/). */
  readonly documents?: QaDocumentsConfig;
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
    readonly minContentWidth: number;
    readonly showSessionList: boolean;
    readonly subagentCodenames: boolean;
  };
  readonly suggestedQuestions: readonly string[];
  readonly thinkingPhrases: readonly string[];
  readonly interaction: {
    readonly approvals: QaApprovalInteraction;
    readonly questions: QaQuestionInteraction;
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
    readonly sharedReadOnlyRoots: readonly string[];
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
    /** Per-account starter buttons above an empty composer. */
    readonly starters: {
      readonly enabled: boolean;
    };
    /**
     * Personal Skills. Resolution turns the flag off on any deployment that
     * cannot give every account its own directory: the storage root is the
     * account's own workspace, so there is no safe shared fallback.
     */
    skills: {
      readonly enabled: boolean;
      readonly relativeRoot: string;
      readonly watch: boolean;
      readonly maxSkillBytes: number;
      readonly allowResourceEditing: boolean;
    };
  };
  readonly entry: {
    readonly redirectNonLoopback: boolean;
    readonly cookieBootstrap: boolean;
  };
  readonly tools: {
    readonly dynamicActivation: boolean;
    readonly activationSkill: string;
    readonly activationMode: QaToolActivationMode;
    readonly activationPresets: readonly string[];
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
      readonly validateReportedSources: boolean;
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
  readonly documents: ResolvedQaDocumentsConfig;
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
        /** Muted correlation line above the body (task name, session id). */
        readonly meta?: string;
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

export interface QaSessionState {
  readonly phase: QaSessionPhase;
  readonly sessionId: string | null;
  readonly messages: readonly QaMessage[];
  /** Immediate send feedback, kept outside the durable transcript. */
  readonly pendingMessage: QaPendingUserMessage | null;
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
  /** Tool calls parked for the operator's answer, oldest first. */
  readonly approvals: readonly QaPendingApproval[];
  /** Question requests parked for the operator's answer, oldest first. */
  readonly questions: readonly QaPendingQuestion[];
}
/** Minimal server-trusted identity exposed to principal-scoped plugins. */
export interface QaPrincipal {
  readonly userId: string;
}
