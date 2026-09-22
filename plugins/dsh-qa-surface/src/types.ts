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
/**
 * What a deployment may write for the question seam. `enabled` is accepted as
 * the spelling of `interactive` a feature request asked for; the resolved
 * config carries one name only.
 */
export type QaQuestionInteractionInput = QaQuestionInteraction | "enabled";
/** The operator's answer to one parked tool call. */
export type QaApprovalDecision = "allowed-once" | "rejected";
/** One answered question; `custom` is free text, and may accompany `selected`. */
export interface QaQuestionAnswerItem {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}
/**
 * Authorization inside QA Surface. It is deliberately independent of a QA
 * subrole: an admin may work as any analyst profile while still holding the
 * administrative permissions, and a reviewer answers conversations without
 * being able to manage accounts.
 */
export type QaAccountRole = "user" | "reviewer" | "admin";

/** Administrative permissions a role grants; see `admin/permissions.ts`. */
export type QaPermission =
  | "users.read"
  | "users.manage"
  | "roles.read"
  | "roles.manage"
  | "conversations.read.all"
  | "conversations.read.own"
  | "conversations.delete"
  | "reviews.read"
  | "reviews.write"
  | "analytics.read"
  | "audit.read"
  | "settings.manage"
  /** Write access to skill files, personal and deployment-wide. */
  | "skills.manage";

/**
 * Tools split by how they become available. `always` is visible from the first
 * model step; `skillGrantable` is a ceiling — the tool only appears once an
 * activated skill requires it, and never outside this list.
 */
export interface QaToolSelection {
  readonly always: readonly string[];
  readonly skillGrantable: readonly string[];
  /**
   * Names this layer takes away, whatever grants them.
   *
   * The deployment's pinned tools and the Common layer reach every role, so
   * without this a system tool could only be withdrawn by editing the profile
   * and restarting the Host. A denial beats every grant — system, Common, the
   * role's own list and every skill — and it narrows the ceiling a delegated
   * assistant is held to, so one checkbox takes a tool away from a role and
   * from the experts that role may spawn.
   */
  readonly deny?: readonly string[];
}

/** Tool/skill selection shared by the common layer and one QA subrole. */
export interface QaCapabilitySelection {
  readonly tools: QaToolSelection;
  readonly skills: readonly string[];
  /** Reserved extension seams; v1 enforcement intentionally ignores them. */
  readonly mcpServers?: readonly string[];
  readonly knowledgeSources?: readonly string[];
  readonly promptAdditions?: readonly string[];
}

/** Audience one skill declares for itself in its own SKILL.md metadata. */
export type QaSkillAudience =
  | { readonly type: "unassigned" }
  | { readonly type: "common" }
  | { readonly type: "subroles"; readonly include: readonly string[] };

/**
 * Normalized `metadata.qa-surface` of one skill. Discovery never throws on a
 * malformed block: the fields fall back to the fail-closed defaults and every
 * complaint lands in `warnings` for the administration surface.
 */
export interface QaSkillDescriptor {
  readonly name: string;
  readonly audience: QaSkillAudience;
  /** Tools the skill needs to work; the role ceiling still decides the grant. */
  readonly requiredTools: readonly string[];
  /** Whether activation must be refused when one required tool is unavailable. */
  readonly requireAll: boolean;
  readonly lifecycle: "session";
  /** `metadata.qa-surface.version`; 0 when the block declared none. */
  readonly schemaVersion: number;
  /** Whether the skill carried a readable qa-surface metadata block. */
  readonly declared: boolean;
  readonly warnings: readonly string[];
}

/**
 * Administrator overlay over one skill's declared audience. The skill file is
 * never rewritten: assignments are stored beside the policy and merged here.
 */
export interface QaSkillAssignmentOverride {
  readonly skillName: string;
  readonly addToSubroles?: readonly string[];
  readonly removeFromSubroles?: readonly string[];
  readonly forceCommon?: boolean;
  readonly disabled?: boolean;
}

export type QaSkillHealth = "healthy" | "degraded" | "blocked" | "unassigned";

/** Per-role projection of one skill: what the role sees and what it may grant. */
export interface QaSkillRoleGrant {
  readonly roleId: string;
  readonly visible: boolean;
  readonly declared: boolean;
  readonly addedByAdmin: boolean;
  readonly removedByAdmin: boolean;
  readonly disabled: boolean;
  /** Required tools this role's ceiling admits. */
  readonly grantableTools: readonly string[];
  /** Required tools this role cannot grant: outside the ceiling or not installed. */
  readonly unavailableTools: readonly string[];
}

/** One row of the administration Skills table plus its detail view. */
export interface QaSkillAccess {
  readonly name: string;
  readonly description?: string;
  readonly whenToUse?: string;
  readonly source: QaCapabilityDescriptor["source"];
  readonly status: "available" | "missing";
  readonly descriptor: QaSkillDescriptor;
  /** Roles whose policy currently exposes the skill. */
  readonly visibleTo: readonly string[];
  readonly disabled: boolean;
  readonly forceCommon: boolean;
  readonly overridden: boolean;
  readonly health: QaSkillHealth;
  /** Every required tool with the union of roles that could grant it. */
  readonly tools: readonly {
    readonly id: string;
    readonly installed: boolean;
    readonly grantableBy: readonly string[];
    readonly blockedFor: readonly string[];
  }[];
  readonly roles: readonly QaSkillRoleGrant[];
}

/** Why a skill activation was attempted; recorded for conversation review. */
export type QaSkillActivationOrigin = "model" | "user" | "preview";

/**
 * One activation attempt on a live session, appended to the session record.
 * `denied` covers an audience refusal, `rejected` a failed `requireAll` check.
 */
export interface QaSkillActivationRecord {
  readonly timestamp: string;
  readonly skillName: string;
  readonly origin: QaSkillActivationOrigin;
  readonly outcome: "activated" | "rejected" | "denied";
  readonly requestedTools: readonly string[];
  readonly grantedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly reason?: string;
}

/** One agent capability profile. It never grants administrative access. */
export interface QaSubrole {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly capabilities: QaCapabilitySelection;
  readonly ui?: {
    readonly icon?: string;
    readonly accent?: string;
  };
}

/** Host-owned, versioned capability configuration. */
export interface QaCapabilityConfig {
  readonly version: 1;
  readonly common: QaCapabilitySelection;
  readonly subroles: readonly QaSubrole[];
  /** Administrator assignments layered over what each skill declares. */
  readonly skillOverrides: readonly QaSkillAssignmentOverride[];
}

/** The QA profiles one account may choose, independently of its access role. */
export interface QaUserAccess {
  readonly allowedSubroles: readonly string[];
  readonly defaultSubrole: string;
}

export type QaCapabilitySourceKind =
  "core" | "plugin" | "mcp" | "filesystem" | "runtime";

/** One capability currently installed, or retained as a missing selection. */
export interface QaCapabilityDescriptor {
  readonly type: "tool" | "skill";
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly source: {
    readonly kind: QaCapabilitySourceKind;
    readonly name?: string;
  };
  readonly status: "available" | "missing";
  readonly modelInvocable?: boolean;
  readonly userInvocable?: boolean;
}

/** JSON-safe projection of an immutable policy snapshot. */
export interface QaEffectiveCapabilityPolicy {
  readonly subroleId: string;
  /** Tools visible from the first model step, before any skill is loaded. */
  readonly tools: readonly string[];
  /** Ceiling for the tools an activated skill may add to this session. */
  readonly grantableTools: readonly string[];
  /** Skills the model may see and load for the frozen subrole. */
  readonly skills: readonly string[];
  /**
   * Visible skills a person may invoke with `/name`, including skills that
   * opted out of model invocation and therefore stay out of the catalog.
   */
  readonly userSkills: readonly string[];
  readonly sources: {
    readonly systemTools: readonly string[];
    readonly commonTools: readonly string[];
    readonly roleTools: readonly string[];
    readonly commonGrantableTools: readonly string[];
    readonly roleGrantableTools: readonly string[];
    readonly systemSkills: readonly string[];
    readonly commonSkills: readonly string[];
    readonly roleSkills: readonly string[];
    /** Skills this subrole received from their own SKILL.md audience. */
    readonly declaredSkills: readonly string[];
  };
  readonly missingTools: readonly string[];
  readonly missingSkills: readonly string[];
  /** Revision of the resolved policy, recorded with the session snapshot. */
  readonly policyRevision: string;
}

export type QaAccessAuditAction =
  | "subrole.created"
  | "subrole.updated"
  | "subrole.deleted"
  | "common.updated"
  | "assignment.updated"
  | "skill.assignment-updated";

export interface QaAccessAuditEvent {
  readonly timestamp: string;
  readonly actorId: string;
  readonly action: QaAccessAuditAction;
  readonly targetId?: string;
  /** JSON snapshots serialized at the storage boundary for a strict Remote type. */
  readonly before?: string;
  readonly after?: string;
}

/** Admin table row: credentials and token material are never projected. */
export interface QaAccessUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly accessRole: QaAccountRole;
  readonly disabled: boolean;
  readonly access: QaUserAccess;
}

/** Ordinary user's role selector data. */
export interface QaCurrentAccess {
  readonly subroles: readonly QaSubrole[];
  readonly defaultSubrole: string;
}

/** The role pinned to one existing session. */
export interface QaSessionAccess {
  readonly subrole: QaSubrole;
  readonly adminPreview: boolean;
}

/** One authoritative payload for the /qa/admin application. */
export interface QaAccessAdminSnapshot {
  readonly config: QaCapabilityConfig;
  /** Immutable capabilities inherited by every role; exposed read-only. */
  readonly systemRequired: QaCapabilitySelection;
  readonly catalog: readonly QaCapabilityDescriptor[];
  /** Every discovered skill with its declared audience and grant ceiling. */
  readonly skills: readonly QaSkillAccess[];
  readonly users: readonly QaAccessUser[];
  readonly audit: readonly QaAccessAuditEvent[];
}

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

/**
 * One forgotten-password request waiting for an operator. The address and name
 * travel with it so the console can show who is locked out without a second
 * lookup; the count makes repeated taps visible instead of silent.
 */
export interface QaPasswordResetRequest {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly requestedAt: string;
  readonly lastRequestedAt: string;
  readonly requestCount: number;
  /** True when the account is disabled: a reset will not let it sign in. */
  readonly disabled: boolean;
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
 * What an integration token may do. The credential a non-browser application
 * presents to the QA HTTP API carries its own scopes, so a bridge that asks
 * questions cannot read back conversations it was never given.
 */
export type QaServiceTokenScope = "ask" | "sessions:read";

/**
 * What an account asks a new integration token to be. The credential is always
 * issued to the caller: nothing a browser sends may name another account, so
 * this shape has no owner field and the administrative path keeps its own.
 */
export interface QaServiceTokenCreateInput {
  /** A note the operator's list shows; empty becomes a generic label. */
  readonly label?: string;
  /** Requested scopes; unknown ones are dropped, empty falls back to `ask`. */
  readonly scopes?: readonly string[];
  /** How long the token lives, in days; bounded server-side. */
  readonly ttlDays?: number;
}

/**
 * One integration token as a list shows it. The plaintext is deliberately not
 * part of this shape: a secret is shown once, when it is minted, and a list
 * that could repeat it would be a list that leaks it.
 */
export interface QaServiceTokenSummary {
  readonly id: string;
  readonly label: string;
  readonly scopes: readonly QaServiceTokenScope[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly useCount: number;
}

/** One freshly minted token: the plaintext is here and nowhere else, ever. */
export interface QaIssuedServiceToken extends QaServiceTokenSummary {
  /** The credential to hand to the integration. Never recoverable later. */
  readonly token: string;
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
/**
 * One administrator write to a skill somebody else owns.
 *
 * The record exists so a personal skill cannot be changed behind its owner's
 * back: it is written beside the skill and reported on every read, and the
 * owner sees the badge in their own catalog.
 */
export interface QaSkillAdminEdit {
  /** Administrator account id; the owner is told a role, not a colleague. */
  readonly actorId: string;
  /** ISO timestamp of that write. */
  readonly at: string;
}

/**
 * Which skill store an administrator is editing: the deployment-wide shared
 * root every account may read, or one account's own directory.
 */
export type QaAdminSkillScope =
  | { readonly kind: "shared" }
  | { readonly kind: "user"; readonly userId: string };

/** The account a personal skill scope belongs to, for the console's header. */
export interface QaAdminSkillOwner {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

/** One scope's catalog plus the facts the console names it by. */
export interface QaAdminSkillsView {
  readonly scope: QaAdminSkillScope;
  /** The account of a personal scope; null for the shared root. */
  readonly owner: QaAdminSkillOwner | null;
  readonly skills: readonly QaSkillSummary[];
  /** Absolute directory this scope reads and writes, rendered read-only. */
  readonly rootPath: string;
}

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
  /**
   * The administrator write that produced the stored revision, or null. A
   * record whose revision no longer matches is stale and reports as null: the
   * badge answers "did an administrator write what I am looking at", not
   * "was this skill ever touched by an administrator".
   */
  readonly adminEdit: QaSkillAdminEdit | null;
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

// ---------------------------------------------------------------------------
// Slash interface: the unified catalog, its policy and the command outcome.
// QA owns presentation, filtering and admission; it owns no skill or command
// registry of its own — every entry below is a projection of a native one.
// ---------------------------------------------------------------------------

/** Which native registry one unified entry came from. */
export type QaSlashEntryKind = "skill" | "command";

/** How one half of the catalog admits native entries. */
export type QaSlashPolicyMode = "deny-all" | "allow-list" | "all";

export interface QaSlashPolicyConfig {
  readonly mode?: QaSlashPolicyMode;
  readonly allow?: readonly string[];
}

export interface QaSlashPaletteConfig {
  readonly enabled?: boolean;
  /** Run the two weakest matcher rungs (substring, subsequence). */
  readonly fuzzySearch?: boolean;
  readonly maxVisible?: number;
  readonly showDescriptions?: boolean;
  readonly showKindBadge?: boolean;
}

export interface QaSlashCommandsConfig {
  readonly skills?: QaSlashPolicyConfig;
  readonly commands?: QaSlashPolicyConfig;
  readonly palette?: QaSlashPaletteConfig;
}

export interface ResolvedQaSlashCommands {
  /** Mirror of `lockdown.allowSlashCommands`; the one master switch. */
  readonly enabled: boolean;
  readonly skills: {
    readonly mode: QaSlashPolicyMode;
    readonly allow: readonly string[];
  };
  readonly commands: {
    readonly mode: QaSlashPolicyMode;
    readonly allow: readonly string[];
  };
  readonly palette: {
    readonly enabled: boolean;
    readonly fuzzySearch: boolean;
    readonly maxVisible: number;
    readonly showDescriptions: boolean;
    readonly showKindBadge: boolean;
  };
  /**
   * True when the deployment turned the master switch on without declaring a
   * `slashCommands` section: skills then admit every user-invocable skill the
   * session already exposes, commands stay denied. The Host logs it once, so
   * an upgrade cannot silently widen anything.
   */
  readonly legacyDefaults: boolean;
}

/**
 * One palette row. `id` is the routing identity: skill and command may share a
 * name, so identity is `skill:<name>` or `command:<name>` and never the bare
 * name the two halves would collide on.
 */
export interface QaSlashCatalogEntry {
  readonly id: string;
  readonly kind: QaSlashEntryKind;
  readonly name: string;
  readonly description: string;
  /** Skill-only: the native `whenToUse`, rendered as secondary copy. */
  readonly whenToUse?: string;
  /** Skill-only: whether the model is also offered this skill. */
  readonly modelInvocable?: boolean;
  /** Command-only: the advertised argument shape. */
  readonly inputHint?: string;
  /** Command-only: whether the executor admits composer attachments. */
  readonly acceptsAttachments?: boolean;
}

/**
 * Whether the command half of the catalog could be read. `inactive` is the
 * ordinary state of a cold chat: the native command registry resolves through
 * a live Agent, and a chat with none answers with no commands rather than an
 * error — the palette then offers skills alone.
 */
export type QaSlashCommandSurface = "ready" | "unavailable" | "inactive";

export interface QaSlashCatalog {
  /** False while `lockdown.allowSlashCommands` is off. */
  readonly enabled: boolean;
  readonly entries: readonly QaSlashCatalogEntry[];
  readonly commandSurface: QaSlashCommandSurface;
  /**
   * User-invocable skills of this chat that the deployment or the chat's role
   * withheld from the palette. Naming them is what lets the browser warn about
   * a `/name` typed inside an ordinary prompt — the native gesture path never
   * consults this list, so it is a courtesy, not an authorization.
   */
  readonly deniedSkills: readonly string[];
}

/**
 * One composer attachment offered to a human command. The same two shapes the
 * prompt path uses — an image rides inline, a file rides its staged receipt —
 * because the native executor admits both through one attachment store.
 */
export type QaSlashSubmitAttachment =
  | {
      readonly type: "image";
      readonly mediaType: QaImageMediaType;
      readonly data: string;
      readonly name?: string;
    }
  | { readonly type: "file"; readonly receiptId: string };

/** Why a command line was refused before, or instead of, running. */
export type QaSlashRefusal =
  | "slash-disabled"
  | "unknown-command"
  | "not-allowed"
  | "attachments-unsupported"
  | "inactive-session";

export type QaSlashCommandOutcome =
  | {
      readonly kind: "success";
      readonly text?: string;
      /** Earlier authoritative event this result is presented from. */
      readonly sourceEventSeq?: number;
    }
  | { readonly kind: "error"; readonly text: string };

/**
 * The result of one admitted command. `refused` is an admission decision and
 * costs nothing; `executed` means the native runtime ran the handler and the
 * lifecycle is already in the session log, which is what the transcript row
 * projects.
 */
export type QaSlashExecution =
  | {
      readonly kind: "executed";
      readonly commandId: string;
      readonly outcome: QaSlashCommandOutcome;
    }
  | {
      readonly kind: "refused";
      readonly reason: QaSlashRefusal;
      /** Host-authored detail; the browser renders its own copy for `reason`. */
      readonly message: string;
    };

/** One entry of the palette the browser is filtering. */
export interface QaSlashView {
  readonly enabled: boolean;
  readonly state: "idle" | "loading" | "ready" | "error";
  readonly entries: readonly QaSlashCatalogEntry[];
  readonly commandSurface: QaSlashCommandSurface;
  readonly deniedSkills: readonly string[];
  /** Set when the catalog could not be read; ordinary prompts keep working. */
  readonly error: string | null;
  /**
   * Bumped when the surface must re-open a palette the user had dismissed —
   * an ambiguous `/name` is the case that needs it. The composer watches the
   * counter rather than the message, so a refusal can be re-stated.
   */
  readonly reopen: number;
}

/**
 * One human command line projected into the transcript. Commands never enter
 * the model conversation, so this row is their only visible trace; it is a
 * control row, not an assistant bubble.
 */
export interface QaCommandActivity {
  readonly commandId: string;
  readonly name: string;
  /** Verbatim text after the name, with its separator whitespace removed. */
  readonly args?: string;
  readonly state: "running" | "success" | "error";
  readonly resultText?: string;
  readonly sourceEventSeq?: number;
}

export interface QaSourceFilePreview {
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly truncated: boolean;
  readonly markdown: boolean;
  readonly renderableMarkdown: boolean;
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
      /**
       * Position of this answer in the session's durable event log. Feedback is
       * keyed to it: a rating survives a replay, a reload and a role change,
       * while the browser's own message id does not.
       */
      readonly seq?: number;
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
  /**
   * An owner-authorized historical chat whose recorded composition no longer
   * matches the deployment. Its transcript remains visible, but no Host
   * operation may be issued through this binding.
   */
  readonly compatibilityReadOnly?: boolean;
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
  /** Slash palette state, keyed to the chat this snapshot describes. */
  readonly slash: QaSlashView;
}
/** Minimal server-trusted identity exposed to principal-scoped plugins. */
export interface QaPrincipal {
  readonly userId: string;
}

// ---------------------------------------------------------------------------
// Quality layer: user feedback, reviewer results, and the admin audit trail.
// These are the durable records the admin console reads and writes; every one
// is keyed to an exact conversation message, never to a conversation alone.
// ---------------------------------------------------------------------------

/** A user's verdict on one assistant message. Binary by design. */
export type QaFeedbackRating = "positive" | "negative";

/**
 * Optional negative-feedback reasons. The list is short on purpose: asking for
 * a precise cause at rating time costs more answers than it buys insight, and
 * a reviewer classifies the hard cases afterwards.
 */
export type QaFeedbackReason =
  | "incorrect"
  | "instruction_not_followed"
  | "missing_information"
  | "outdated_information"
  | "tool_issue"
  | "too_verbose"
  | "too_short"
  | "other";

/** One user's rating of one assistant message. */
export interface QaMessageFeedback {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly rating: QaFeedbackRating;
  readonly reasons?: readonly QaFeedbackReason[];
  readonly comment?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** The rating fields a browser may write; identity and time are Host-owned. */
export interface QaMessageFeedbackInput {
  readonly rating: QaFeedbackRating;
  readonly reasons?: readonly QaFeedbackReason[];
  readonly comment?: string;
}

/** Review workflow state of a conversation or one of its messages. */
export type QaReviewStatus =
  "unreviewed" | "in_review" | "reviewed" | "needs_followup";

/**
 * Reviewer taxonomy, grouped the way the spec groups it. Issue ids stay flat so
 * aggregations never depend on walking a tree in the browser.
 */
export type QaQualityIssueType =
  | "answer.incorrect"
  | "answer.incomplete"
  | "answer.hallucination"
  | "answer.request_not_followed"
  | "answer.poor_formatting"
  | "answer.communication"
  | "context.missing_conversation"
  | "context.missing_knowledge"
  | "context.outdated_knowledge"
  | "tool.wrong_selection"
  | "tool.should_have_been_used"
  | "tool.bad_arguments"
  | "tool.failure"
  | "tool.unavailable"
  | "skill.missing"
  | "skill.wrong"
  | "skill.not_followed"
  | "skill.prompt_policy"
  | "access.missing_capability"
  | "access.excessive_capability"
  | "other";

export type QaQualitySeverity = "minor" | "major" | "critical";

/** Where a reviewer thinks the fix belongs; the loop's change target. */
export type QaRemediationTarget =
  | "prompt"
  | "skill"
  | "tool"
  | "knowledge"
  | "role"
  | "model"
  | "product_ux"
  | "user_misunderstanding"
  | "unknown";

/** One reviewer result. `needs_followup` keeps the item in the queue. */
export interface QaConversationReview {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId?: string;
  readonly reviewerId: string;
  readonly status: "reviewed" | "needs_followup";
  readonly issues: readonly QaQualityIssueType[];
  readonly severity: QaQualitySeverity;
  readonly notes?: string;
  readonly target?: QaRemediationTarget;
  readonly suggestedAction?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** A reviewer's write; ids, author and first-seen time are Host-owned. */
export interface QaConversationReviewInput {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly status: "reviewed" | "needs_followup";
  readonly issues: readonly QaQualityIssueType[];
  readonly severity: QaQualitySeverity;
  readonly notes?: string;
  readonly target?: QaRemediationTarget;
  readonly suggestedAction?: string;
}

/** Why a conversation entered the review queue. */
export type QaReviewReason =
  "negative_feedback" | "manual" | "tool_failure" | "automatic";

export type QaReviewPriority = "low" | "normal" | "high";

/** One queue row: a conversation needing attention, with its derived state. */
export interface QaReviewQueueItem {
  readonly conversationId: string;
  readonly messageId?: string;
  readonly reason: QaReviewReason;
  readonly priority: QaReviewPriority;
  readonly status: QaReviewStatus;
  readonly assignedReviewerId?: string;
  /** ISO time of the signal that put the item in the queue. */
  readonly raisedAt: string;
  readonly reviewerId?: string;
  readonly reviewId?: string;
  readonly feedbackId?: string;
}

/** Administrative actions recorded in the audit trail. */
export type QaAdminAuditAction =
  | "user.created"
  | "user.updated"
  | "user.enabled"
  | "user.disabled"
  /** An operator set a new password for an account that had requested one. */
  | "user.password-reset"
  | "authorization.changed"
  | "subrole.assignment.changed"
  | "subrole.created"
  | "subrole.updated"
  | "subrole.deleted"
  | "common_capabilities.updated"
  | "conversation.reviewed"
  | "conversation.deleted"
  | "review.updated"
  | "review.queued"
  | "admin.settings.updated"
  | "skill.created"
  | "skill.updated"
  | "skill.deleted";

export interface QaAdminAuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actorId: string;
  readonly action: QaAdminAuditAction;
  readonly targetType?: string;
  readonly targetId?: string;
  /** JSON snapshots serialized at the storage boundary for a strict Remote type. */
  readonly before?: string;
  readonly after?: string;
}

/**
 * One tool call as the review viewer shows it. `arguments` and `result` are
 * preview strings, not raw payloads: the admin redaction seam owns trimming.
 */
export interface QaConversationToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
  readonly result?: string;
  readonly error?: string;
  readonly time?: number;
  readonly durationMs?: number;
}

/** Token accounting of one assistant message, when the log carries it. */
export interface QaMessageUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
}

/** One message in the review viewer, in log order. */
export interface QaConversationMessage {
  /** Stable message identity: the session event seq it was projected from. */
  readonly id: string;
  readonly seq: number;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly time: number;
  readonly model?: string;
  readonly provider?: string;
  readonly usage?: QaMessageUsage;
  readonly interrupted?: boolean;
  readonly toolCalls?: readonly QaConversationToolCall[];
  /** Ratings of this message by its owner, newest first. */
  readonly feedback?: readonly QaMessageFeedback[];
  /** Reviewer results attached to this exact message. */
  readonly reviews?: readonly QaConversationReview[];
}

/**
 * What the agent could use in a conversation, frozen when the session was
 * reserved. Reviewing an old answer against today's role configuration would
 * answer the wrong question.
 */
export interface QaConversationRuntime {
  readonly subroleId: string;
  readonly adminPreview: boolean;
  readonly model?: string;
  readonly provider?: string;
  readonly agentPreset?: string;
  readonly effectiveTools?: readonly string[];
  readonly effectiveSkills?: readonly string[];
  /** Skills the model actually loaded, derived from the log's skill tool calls. */
  readonly loadedSkills?: readonly string[];
  /** True when the stored log could not be read; counts stay 0 and text is absent. */
  readonly transcriptUnavailable?: QaTranscriptUnavailableReason;
}

/** Why a stored transcript could not be projected for the reviewer. */
export type QaTranscriptUnavailableReason =
  "storage-unavailable" | "not-found" | "unreadable";

/** One conversation row of the administrative list. */
export interface QaConversationSummary {
  readonly conversationId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly subroleId: string;
  readonly createdAt: string;
  /** Newest activity the deployment can see: creation, log tail, or a review. */
  readonly updatedAt: string;
  readonly title?: string;
  readonly messageCount: number;
  readonly positiveFeedback: number;
  readonly negativeFeedback: number;
  readonly reviewStatus: QaReviewStatus;
}

/** The full review payload of one conversation. */
export interface QaConversationDetail {
  readonly conversationId: string;
  readonly summary: QaConversationSummary;
  readonly runtime: QaConversationRuntime;
  readonly messages: readonly QaConversationMessage[];
  readonly reviews: readonly QaConversationReview[];
  readonly queueItems: readonly QaReviewQueueItem[];
}

/** What one administrative deletion removed, for the console to report. */
export interface QaConversationDeletion {
  readonly conversationId: string;
  /**
   * Every session whose stored log is gone, the chat first: a conversation's
   * subagent sessions are part of it and are removed with it.
   */
  readonly sessions: readonly string[];
  /** Quality rows dropped with the conversation. */
  readonly qualityRows: number;
}

/**
 * Server-side filter for the conversation list. Every field is optional and
 * accepts an explicit null: the wire carries whatever the browser has, and an
 * absent filter must never be mistaken for a filter on `null`.
 */
export interface QaConversationQuery {
  readonly userId?: string | null;
  readonly subroleId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly rating?: QaFeedbackRating | null;
  readonly reviewStatus?: QaReviewStatus | null;
  /** Search matches the conversation title and the owner's name or email. */
  readonly search?: string | null;
}

/** Server-side filter for the feedback table. */
export interface QaFeedbackQuery {
  readonly rating?: QaFeedbackRating | null;
  readonly userId?: string | null;
  readonly subroleId?: string | null;
  readonly reason?: QaFeedbackReason | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly reviewStatus?: QaReviewStatus | null;
}

/** Server-side filter for the audit table. */
export interface QaAuditQuery {
  readonly actorId?: string | null;
  readonly action?: QaAdminAuditAction | null;
  readonly from?: string | null;
  readonly to?: string | null;
}

/** Server-side filter for the user list. */
export interface QaUserQuery {
  readonly search?: string | null;
  readonly status?: "active" | "disabled" | null;
  readonly role?: QaAccountRole | null;
  readonly subroleId?: string | null;
}

/** Cursor page of any admin list. `nextCursor` is null on the last page. */
export interface QaAdminPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/** One pending item of the review queue, with the context to triage it. */
export interface QaReviewQueueRow extends QaReviewQueueItem {
  readonly displayName: string;
  readonly subroleId: string;
  readonly title?: string;
  readonly raisedAtLabel: string;
  readonly issueSummary?: readonly QaQualityIssueType[];
  readonly severity?: QaQualitySeverity;
}

/** One row of the feedback table (spec §33). */
export interface QaFeedbackRow extends QaMessageFeedback {
  readonly displayName: string;
  readonly subroleId: string;
  readonly conversationTitle?: string;
  readonly reviewStatus: QaReviewStatus;
}

/** Aggregated quality counters (spec §27). */
export interface QaQualityIssueCount {
  readonly issue: QaQualityIssueType;
  readonly count: number;
}

export interface QaQualityRatingBreakdown {
  readonly key: string;
  readonly label: string;
  readonly rated: number;
  readonly positive: number;
  readonly negative: number;
  readonly positiveRate: number | null;
}

export interface QaQualityTrendPoint {
  /** ISO date (UTC) of the bucket. */
  readonly date: string;
  readonly rated: number;
  readonly positive: number;
  readonly negative: number;
}

export interface QaQualityMetrics {
  readonly conversations: number;
  readonly activeUsers: number;
  readonly assistantMessages: number;
  readonly ratedMessages: number;
  readonly positiveRatings: number;
  readonly negativeRatings: number;
  /** Share of assistant messages that carry a rating; null without messages. */
  readonly ratingRate: number | null;
  /** Share of positive ratings among rated messages; null without ratings. */
  readonly positiveRate: number | null;
  readonly unreviewedNegatives: number;
  readonly reviewedItems: number;
  readonly issues: readonly QaQualityIssueCount[];
  readonly bySubrole: readonly QaQualityRatingBreakdown[];
  readonly trend: readonly QaQualityTrendPoint[];
}

/**
 * One attention line on the admin overview. The Host reports the condition and
 * its numbers; the browser owns the wording, so an operator's language never
 * depends on the deployment's locale.
 */
export interface QaOverviewAlert {
  readonly level: "critical" | "warning" | "info";
  readonly code:
    "unreviewed-negatives" | "subrole-satisfaction" | "recurring-reason";
  readonly count: number;
  /** Subrole id or feedback reason, when the condition names one. */
  readonly subject?: string;
  /** Positive-feedback share of the subject, when the condition measured one. */
  readonly rate?: number;
}

/** The /qa/admin landing payload. */
export interface QaAdminOverview {
  readonly metrics: QaQualityMetrics;
  readonly alerts: readonly QaOverviewAlert[];
  readonly recentFeedback: readonly QaFeedbackRow[];
  readonly queue: readonly QaReviewQueueRow[];
}

/** The account columns the store owns, without any joined counters. */
export interface QaAdminAccountRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly fullName: string;
  readonly role: QaAccountRole;
  readonly disabled: boolean;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
  readonly access: QaUserAccess;
}

/** One user row of the admin user list (spec §5). */
export interface QaAdminUserRow extends QaAdminAccountRow {
  readonly conversations: number;
  readonly feedbackGiven: number;
}

/** Everything the user detail page renders, in one payload (spec §6). */
export interface QaAdminUserDetail {
  readonly user: QaAdminUserRow;
  /** Effective capability counts per assigned subrole, for the access preview. */
  readonly effective: readonly {
    readonly subroleId: string;
    readonly name: string;
    /** Visible from the first step: system-required, Common and the role. */
    readonly tools: number;
    /** The role's ceiling for tools a loaded skill requires. */
    readonly grantableTools: number;
    /** Tools the profile withdraws, whatever else grants them. */
    readonly deniedTools: number;
    readonly skills: number;
  }[];
  readonly activity: {
    readonly conversations: number;
    /**
     * Unknown until the conversations page is opened: the count needs every
     * conversation's log read, so the detail card reports null instead of
     * blocking its payload on the scan.
     */
    readonly messages: number | null;
    readonly positiveRatings: number;
    readonly negativeRatings: number;
  };
}

/** The administrative write of one account; absent fields stay unchanged. */
export interface QaAdminUserUpdate {
  readonly role?: QaAccountRole | null;
  readonly disabled?: boolean | null;
  readonly access?: QaUserAccess | null;
}
