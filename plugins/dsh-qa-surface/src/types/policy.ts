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
  | "skills.manage"
  /**
   * What the domain experts wrote into their durable memory. Reading is split
   * from correcting because a reviewer is the one who notices a remembered
   * inaccuracy in an answer, and an answer the expert keeps getting wrong is
   * the reviewer's business even though the fix is not.
   */
  | "memory.read"
  | "memory.manage";
