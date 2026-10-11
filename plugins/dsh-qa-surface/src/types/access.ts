import type {
  QaCapabilityConfig,
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaSkillAccess,
  QaSubrole,
  QaUserAccess,
} from "./capability.js";
import type { QaAccountRole } from "./policy.js";

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
