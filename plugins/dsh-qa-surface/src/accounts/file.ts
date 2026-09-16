import { createHash } from "node:crypto";
import path from "node:path";
import type {
  QaAccountRole,
  QaEffectiveCapabilityPolicy,
  QaSkillActivationRecord,
  QaUserAccess,
} from "../types.js";

/** One account's self-declared profile as it rests in the accounts store. */
export interface StoredProfile {
  fullName?: string;
  identities?: Record<string, string>;
  instructions?: string;
  updatedAt?: string;
}

/** One account's starter buttons as they rest in the accounts store. */
export interface StoredStarters {
  items?: { label?: string; prompt?: string }[];
  hideDefaults?: boolean;
}

export interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: QaAccountRole;
  /** scrypt material: hex salt + hex hash. */
  readonly passwordHash: { readonly salt: string; readonly hash: string };
  readonly createdAt: string;
  lastLoginAt: string | null;
  /** Disabled accounts are refused at login and lose their live tokens. */
  disabled?: boolean;
  /**
   * Bumped to invalidate every token ever issued to the account: the value
   * rides the token payload and must match at verification time.
   */
  tokenVersion?: number;
  /** Absent until the owner fills the profile form for the first time. */
  profile?: StoredProfile;
  /** Absent until the owner customizes the starter buttons. */
  starters?: StoredStarters;
  /** Agent capability profiles assigned by an administrator. */
  qaAccess?: QaUserAccess;
}

export interface StoredOwnership {
  readonly userId: string;
  readonly claimedAt: string;
  /** Pinned at creation; absent only on sessions predating subroles. */
  readonly subroleId?: string;
  /** Admin preview is an explicit session fact, never inferred from role=admin. */
  readonly adminPreview?: boolean;
  /** First successful admission freezes the actually installed capabilities. */
  readonly capabilitySnapshot?: QaEffectiveCapabilityPolicy;
  /** Skill activations in order: what the model gained, and when it gained it. */
  readonly skillActivations?: readonly QaSkillActivationRecord[];
}

/**
 * The accounts model as the store holds it in memory, hydrated from the
 * database and invalidated by `PRAGMA data_version` when another process
 * writes. Snapshots appear inline here: the storage layer is what keeps one
 * copy per distinct policy, not the callers.
 */
export interface AccountsFile {
  readonly version: 1;
  /** HMAC key for account tokens; created on first use. */
  readonly secret: string;
  readonly users: StoredUser[];
  readonly ownership: Record<string, StoredOwnership>;
}

/** The accounts database lives next to the DSH home the launcher exports. */
export function defaultAccountsFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-accounts.db",
  );
}

/**
 * Where the pre-SQLite accounts file lived. It is imported on first use and
 * then renamed aside, so a deployment upgrades without re-registering anyone.
 */
export function defaultLegacyAccountsFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-accounts.json",
  );
}

/**
 * A stable digest of one capability policy, so two chats admitted under the
 * same policy share a stored snapshot. Keys are sorted because object key order
 * is an artefact of construction, not part of the policy.
 */
export function snapshotDigest(value: unknown): string {
  const canonical = (input: unknown): string => {
    if (input === null || typeof input !== "object") {
      return JSON.stringify(input) ?? "null";
    }
    if (Array.isArray(input)) {
      return `[${input.map(canonical).join(",")}]`;
    }
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
