import type { QaAccountRole, QaPermission } from "../types.js";

/**
 * The permission each authorization role grants. Roles are compositions, not
 * flags: adding a future "Team Lead" is a new entry here, never a rewrite of
 * the checks at the call sites.
 *
 * These tables are module-private; callers ask {@link permissionsOf} or
 * {@link allows} so no call site can drift from the mapping.
 */
const PERMISSIONS: Readonly<Record<QaAccountRole, readonly QaPermission[]>> = {
  admin: [
    "users.read",
    "users.manage",
    "roles.read",
    "roles.manage",
    "conversations.read.all",
    "conversations.read.own",
    "reviews.read",
    "reviews.write",
    "analytics.read",
    "audit.read",
    "settings.manage",
  ],
  // A reviewer reads every conversation and answers them; accounts, role
  // configuration and deployment settings stay out of reach.
  reviewer: [
    "conversations.read.all",
    "conversations.read.own",
    "reviews.read",
    "reviews.write",
    "analytics.read",
  ],
  user: ["conversations.read.own"],
};

/** Every permission this package knows; the Remote surface validates against it. */
export const QA_PERMISSIONS: readonly QaPermission[] = Object.freeze([
  ...new Set(Object.values(PERMISSIONS).flat()),
]);

/** The permissions one authorization role grants, deduplicated. */
export function permissionsOf(role: QaAccountRole): readonly QaPermission[] {
  return PERMISSIONS[role];
}

/** Whether one role grants one permission. */
export function allows(role: QaAccountRole, permission: QaPermission): boolean {
  return PERMISSIONS[role].includes(permission);
}

/** Whether this role may read conversations it does not own. */
export function readsEveryConversation(role: QaAccountRole): boolean {
  return allows(role, "conversations.read.all");
}
