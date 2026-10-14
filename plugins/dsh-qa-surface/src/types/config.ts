import type { QaAccountIdentityField } from "./accounts.js";
import type {
  QaApprovalInteraction,
  QaApprovalPolicy,
  QaQuestionInteraction,
  QaQuestionInteractionInput,
  QaSandboxMode,
  QaSessionPolicy,
  QaToolActivationMode,
  QaToolPolicyMode,
} from "./policy.js";
import type {
  QaSlashCommandsConfig,
  ResolvedQaSlashCommands,
} from "./slash.js";

export interface QaSourcesConfig {
  readonly enabled?: boolean;
  /**
   * How much durable provenance the deployment keeps. Every bound counts
   * turns, shards or days, and zero keeps everything for that bound.
   */
  readonly retention?: {
    readonly maxTurnsPerSession?: number;
    readonly maxSessions?: number;
    readonly maxAgeDays?: number;
    readonly sweepIntervalMinutes?: number;
  };
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
    readonly maxListingEntries?: number;
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

/**
 * The ambient notes the injector writes into a QA chat as plugin-sourced user
 * messages (`prompt-notes.ts`). Each note can be switched off and reworded;
 * an empty template keeps the built-in wording.
 */
export interface QaNotesConfig {
  /** Who the assistant is talking to; `{identity}` + `{instructions}`. */
  readonly identity?: {
    readonly enabled?: boolean;
    readonly template?: string;
  };
  /** Source-provenance rules; `{reportTool}` names the subagent report tool. */
  readonly sources?: {
    readonly enabled?: boolean;
    readonly template?: string;
    /** The sentence appended when the report-tool fallback is on. */
    readonly fallbackTemplate?: string;
  };
  /** How to label background delegations; no placeholders. */
  readonly delegation?: {
    readonly enabled?: boolean;
    readonly template?: string;
  };
  /** Which reader an attached office document belongs to; no placeholders. */
  readonly documents?: {
    readonly enabled?: boolean;
    readonly template?: string;
  };
  /** Where an answer should come from; no placeholders. */
  readonly sourcePriority?: {
    readonly enabled?: boolean;
    readonly template?: string;
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
    /**
     * How many chat turns the deployment answers at once. A ceiling is what a
     * locally hosted model needs: the card runs out long before the queue does,
     * and a third request makes every answer on the stand slower instead of
     * adding capacity. 0 leaves the count unbounded, which is the default
     * because a hosted model has no such ceiling.
     */
    readonly maxActiveRequests?: number;
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
    readonly questions?: QaQuestionInteractionInput;
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
    /**
     * Absolute path of the documentation tree `docs_search`/`docs_read` read.
     * Leave it empty when the deployment publishes `docs/` inside each chat's
     * own workspace; name it when the corpus is published once, outside every
     * per-user directory, which is otherwise unreadable to those tools.
     */
    readonly docsRoot?: string;
    /**
     * Documentation version `docs_search` stays inside when the model named
     * neither `version` nor `path`. A corpus carries several editions of the
     * same module, and a chat asked about "the product" answers out of whichever
     * edition it happened to read first; naming the stand's edition here lets a
     * search default to it, and an explicit `version` or `path` still decides
     * for itself.
     */
    readonly docsDefaultVersion?: string;
    /**
     * Whether `docsDefaultVersion` is applied. The value stays configured while
     * the switch is off, so a stand can turn the default back on without
     * retyping it.
     */
    readonly docsDefaultVersionEnabled?: boolean;
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
    /**
     * Master switch for the slash interface, and the only capability flag the
     * resolver lets a deployment turn on. It opens the palette, which then
     * offers exactly what `slashCommands` admits — human commands stay denied
     * until the deployment names them. Nothing here widens the tool allow-list,
     * the sandbox or the approval policy.
     */
    readonly allowSlashCommands?: boolean;
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
  /**
   * Slash interface policy. Admission only: the QA surface never implements a
   * skill or command registry, it decides which native ones reach the palette.
   * Inert while `lockdown.allowSlashCommands` is off.
   */
  readonly slashCommands?: QaSlashCommandsConfig;
  readonly embedding?: {
    readonly frameAncestors?: string | null;
  };
  readonly accounts?: {
    readonly localLogin?: boolean;
    readonly oidc?: import("./oidc.js").QaOidcConfig;
    /** Opt-in; the QA gate stays off until the deployment turns this on. */
    readonly enabled?: boolean;
    readonly allowRegistration?: boolean;
    readonly sessionTtlDays?: number;
    /**
     * Login/registration attempts accepted per rolling minute, store-wide.
     * The limit backs the password checks, so the default stays tight.
     */
    readonly maxAuthAttemptsPerMinute?: number;
    /**
     * What happens to ownership records of chats the Harness no longer knows.
     * A record is a chat's auth boundary, so only vanished chats are ever
     * swept, and only after `ownershipGraceHours`.
     */
    readonly retention?: {
      readonly pruneVanishedSessions?: boolean;
      readonly ownershipGraceHours?: number;
      readonly sweepIntervalMinutes?: number;
    };
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
  /** Notices for a turn that ended in one of this browser's own chats. */
  readonly notifications?: {
    /** Master switch: with it off no channel raises anything. */
    readonly enabled?: boolean;
    /**
     * Allow the desktop (operating-system) channel on this stand at all.
     * A reader's own choice only applies while this is on: it is the answer
     * for a shared laptop, where a personal notice is everybody's notice.
     */
    readonly allowOs?: boolean;
  };
  readonly sources?: QaSourcesConfig;
  readonly attachments?: QaAttachmentsConfig;
  readonly notes?: QaNotesConfig;
  readonly integration?: QaIntegrationConfig;
}

/**
 * The HTTP API an external application (the ticket bridge) uses to ask
 * questions and read its own conversations back: `POST {basePath}/ask`,
 * `GET {basePath}/session` and `GET {basePath}/health`, authenticated with an
 * account's integration token. Off unless a deployment asks for it.
 */
export interface QaIntegrationConfig {
  /** Serve the API at all. Requires accounts; off by default. */
  readonly enabled?: boolean;
  /** Route namespace; the endpoints all hang off it. */
  readonly basePath?: string;
  /** Default lifetime of a minted integration token, in days. */
  readonly tokenTtlDays?: number;
  /**
   * Wall-clock budget for one question. The endpoint answers within it — with
   * an escalation when the turn is still running — because the caller's own
   * timeout is a fixed part of the contract.
   */
  readonly requestTimeoutMs?: number;
  /** Questions answered at the same time, deployment wide. */
  readonly maxConcurrent?: number;
  /** Requests one token may make per rolling minute. */
  readonly requestsPerMinute?: number;
  /** Ceiling on one request body, in bytes. */
  readonly maxRequestBytes?: number;
  /** Ceiling on one inline image attachment, in bytes. */
  readonly maxAttachmentBytes?: number;
  /**
   * Ceiling on the published answer, in characters. The caller posts it into a
   * ticket comment, whose own budget is smaller than a model's answer, and a
   * cut made here at a paragraph boundary is readable where the caller's own
   * silent truncation is not.
   */
  readonly maxAnswerCharacters?: number;
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
    readonly maxActiveRequests: number;
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
    readonly allowSlashCommands: boolean;
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
  readonly slashCommands: ResolvedQaSlashCommands;
  readonly embedding: {
    readonly frameAncestors: string | null;
  };
  readonly accounts: {
    readonly localLogin: boolean;
    readonly oidc: import("./oidc.js").ResolvedQaOidcConfig;
    readonly enabled: boolean;
    readonly allowRegistration: boolean;
    readonly sessionTtlDays: number;
    /** Login/registration attempts accepted per rolling minute, store-wide. */
    readonly maxAuthAttemptsPerMinute: number;
    readonly showOtherUsersChats: boolean;
    readonly perUserWorkspace: boolean;
    readonly retention: {
      readonly pruneVanishedSessions: boolean;
      readonly ownershipGraceHours: number;
      readonly sweepIntervalMinutes: number;
    };
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
  /** Channels a finished turn of this browser's own chats may use. */
  readonly notifications: {
    readonly enabled: boolean;
    readonly allowOs: boolean;
  };
  readonly tools: {
    readonly dynamicActivation: boolean;
    readonly activationSkill: string;
    readonly activationMode: QaToolActivationMode;
    readonly activationPresets: readonly string[];
    /**
     * Absolute documentation root the QA catalogue reads, or `""` for the
     * `docs/` directory inside each chat's own workspace.
     */
    readonly docsRoot: string;
    /**
     * Version a search without `version` and without `path` stays inside, or
     * `""` for a search across every edition the corpus carries.
     */
    readonly docsDefaultVersion: string;
    /** Whether the deployment's default version is in force. */
    readonly docsDefaultVersionEnabled: boolean;
  };
  readonly sources: {
    readonly enabled: boolean;
    readonly retention: {
      readonly maxTurnsPerSession: number;
      readonly maxSessions: number;
      readonly maxAgeDays: number;
      readonly sweepIntervalMinutes: number;
    };
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
      readonly maxListingEntries: number;
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
  readonly notes: {
    readonly identity: { readonly enabled: boolean; readonly template: string };
    readonly sources: {
      readonly enabled: boolean;
      readonly template: string;
      readonly fallbackTemplate: string;
    };
    readonly delegation: {
      readonly enabled: boolean;
      readonly template: string;
    };
    readonly documents: {
      readonly enabled: boolean;
      readonly template: string;
    };
    readonly sourcePriority: {
      readonly enabled: boolean;
      readonly template: string;
    };
  };
  readonly integration: {
    readonly enabled: boolean;
    readonly basePath: string;
    readonly tokenTtlDays: number;
    readonly requestTimeoutMs: number;
    readonly maxConcurrent: number;
    readonly requestsPerMinute: number;
    readonly maxRequestBytes: number;
    readonly maxAttachmentBytes: number;
    readonly maxAnswerCharacters: number;
  };
}
