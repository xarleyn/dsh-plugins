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

/**
 * One provider and model pair, fixed by policy rather than chosen in the
 * interface. `provider` and `model` are named together or not at all, because
 * the Host refuses either of them alone.
 */
export interface QaModelPair {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** One agent capability profile. It never grants administrative access. */
export interface QaSubrole {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly capabilities: QaCapabilitySelection;
  /**
   * The pair every chat of this role is opened on, whatever the visitor picks
   * in the interface. Absent means the role keeps no opinion and the
   * deployment's pair serves it.
   */
  readonly model?: QaModelPair;
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

/**
 * One pair the Host can serve right now, as the administration surface lists
 * it. A projection of the harness catalog, so the browser never learns the
 * provider's own catalog shape and a policy can only be written by picking one
 * of these.
 */
export interface QaModelCatalogEntry {
  readonly provider: string;
  readonly model: string;
  /** The catalog's display name for the model, or its id when it has none. */
  readonly label: string;
  readonly reasoningEfforts: readonly string[];
}

/** The QA profiles one account may choose, independently of its access role. */
export interface QaUserAccess {
  readonly allowedSubroles: readonly string[];
  readonly defaultSubrole: string;
  /**
   * The pair this account is opened on, ahead of what its role says: a support
   * desk runs on the local model even when it borrows a role the rest of the
   * deployment shares. Absent means the account keeps no opinion.
   */
  readonly model?: QaModelPair;
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
   * opted out of model invocation and therefore stay out of the catalog. The
   * skills this account owns are here for it without a role grant, unless an
   * administrator has withdrawn the name outright.
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
