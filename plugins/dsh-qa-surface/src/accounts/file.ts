import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import type {
  QaAccountRole,
  QaEffectiveCapabilityPolicy,
  QaSkillActivationRecord,
  QaUserAccess,
} from "../types.js";
import { base64Url } from "./token.js";

/** One account's self-declared profile as it rests in the accounts file. */
export interface StoredProfile {
  fullName?: string;
  identities?: Record<string, string>;
  instructions?: string;
  updatedAt?: string;
}

/** One account's starter buttons as they rest in the accounts file. */
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

/** How ownership rests in the file: the snapshot is a reference, not a copy. */
interface StoredOwnershipOnDisk extends Omit<
  StoredOwnership,
  "capabilitySnapshot"
> {
  readonly snapshotRef?: string;
}

export interface AccountsFile {
  readonly version: 1;
  /** HMAC key for account tokens; rotated on password change by rewriting it. */
  readonly secret: string;
  readonly users: StoredUser[];
  readonly ownership: Record<string, StoredOwnership>;
  /**
   * Capability snapshots, one copy per distinct policy.
   *
   * Every admitted chat freezes the capabilities it was admitted with, and on
   * a real deployment those snapshots are almost always the same list: 25 of
   * them were byte-identical on the live stand and made up 45% of the file.
   * Content addressing keeps one copy and gives each chat a reference to it,
   * which is lossless where a per-chat copy was merely redundant.
   */
  readonly snapshots: Record<string, QaEffectiveCapabilityPolicy>;
}

/** The on-disk shape: ownership rows point into `snapshots`. */
interface AccountsFileOnDisk extends Omit<
  AccountsFile,
  "ownership" | "snapshots"
> {
  readonly ownership: Record<string, StoredOwnershipOnDisk>;
  /** Absent on files written before snapshots were content-addressed. */
  readonly snapshots?: Record<string, QaEffectiveCapabilityPolicy>;
}

/**
 * A stable digest of one policy, so two chats admitted under the same policy
 * share a snapshot. Keys are sorted because object key order is an artefact of
 * construction, not part of the policy.
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

/**
 * Model → disk: move every inline snapshot into the shared map and leave a
 * reference behind, dropping snapshots no chat refers to any more.
 */
function toOnDisk(file: AccountsFile): AccountsFileOnDisk {
  const snapshots: Record<string, QaEffectiveCapabilityPolicy> = {};
  const ownership: Record<string, StoredOwnershipOnDisk> = {};
  for (const [sessionId, owner] of Object.entries(file.ownership)) {
    const { capabilitySnapshot, ...rest } = owner;
    if (capabilitySnapshot === undefined) {
      ownership[sessionId] = rest;
      continue;
    }
    const digest = snapshotDigest(capabilitySnapshot);
    snapshots[digest] = capabilitySnapshot;
    ownership[sessionId] = { ...rest, snapshotRef: digest };
  }
  return {
    version: 1,
    secret: file.secret,
    users: file.users,
    ownership,
    snapshots,
  };
}

/**
 * Disk → model: resolve every reference into the inline snapshot the rest of
 * the plugin reads. A dangling reference is a corrupt file rather than an
 * expected state, and it is refused: silently dropping the snapshot would let
 * the chat be re-admitted under a policy it was never granted.
 */
function fromOnDisk(file: AccountsFileOnDisk): AccountsFile {
  const snapshots = file.snapshots ?? {};
  const ownership: Record<string, StoredOwnership> = {};
  for (const [sessionId, owner] of Object.entries(file.ownership ?? {})) {
    const { snapshotRef, ...rest } = owner;
    if (snapshotRef === undefined) {
      ownership[sessionId] = rest;
      continue;
    }
    const snapshot = snapshots[snapshotRef];
    if (snapshot === undefined) {
      throw new Error(
        `qa-accounts: session ${sessionId} refers to missing capability snapshot ${snapshotRef}; refusing to serve a corrupt accounts file`,
      );
    }
    ownership[sessionId] = { ...rest, capabilitySnapshot: snapshot };
  }
  return {
    version: 1,
    secret: file.secret,
    users: file.users,
    ownership,
    snapshots,
  };
}

/** mtime+size pair identifying one on-disk version of the accounts file. */
export interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * Where the last-seen stamp lives. Load and persist keep it current in place,
 * so a caller holds one mutable ref instead of threading the stamp through
 * every read-modify-write.
 */
export interface FileStampRef {
  current: FileStamp;
}

/** A stamp no real file can match, so the first load always reads the disk. */
export function createFileStampRef(): FileStampRef {
  return { current: { mtimeMs: Number.NEGATIVE_INFINITY, size: -1 } };
}

export function stampOf(stat: Stats): FileStamp {
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

const SECRET_BYTES = 32;

/** The accounts file lives next to the DSH home the launcher exports. */
export function defaultAccountsFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-accounts.json",
  );
}

/**
 * Read the accounts file, or create it on first run with a fresh token
 * secret. The stamp ref is left pointing at the version just read.
 */
export function loadAccountsFile(
  filePath: string,
  stamp: FileStampRef,
): AccountsFile {
  let raw: string;
  let stat: Stats | undefined;
  try {
    raw = readFileSync(filePath, "utf8");
    stat = statSync(filePath);
  } catch (error) {
    // Only a missing file means "first run": anything else (permissions,
    // a directory in the way, I/O failure) must surface, or the store
    // would silently reset every account it cannot read.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const created: AccountsFile = {
      version: 1,
      secret: base64Url(randomBytes(SECRET_BYTES)),
      users: [],
      ownership: {},
      snapshots: {},
    };
    persistAccountsFile(filePath, created, stamp);
    return created;
  }
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as AccountsFile).version !== 1 ||
    typeof (parsed as AccountsFile).secret !== "string" ||
    !Array.isArray((parsed as AccountsFile).users)
  ) {
    throw new Error(
      `qa-accounts: ${filePath} is not a recognizable accounts file; refusing to overwrite it`,
    );
  }
  const file = parsed as AccountsFileOnDisk;
  if (stat !== undefined) stamp.current = stampOf(stat);
  return fromOnDisk({
    version: 1,
    secret: file.secret,
    users: file.users,
    ownership: file.ownership ?? {},
    ...(file.snapshots === undefined ? {} : { snapshots: file.snapshots }),
  });
}

/**
 * Persist the accounts file atomically (temp file + rename) and leave the
 * stamp ref pointing at the freshly written version.
 */
export function persistAccountsFile(
  filePath: string,
  file: AccountsFile,
  stamp: FileStampRef,
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  // A per-process temp name: the Host and the CLI never race on one file.
  const temp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(toOnDisk(file), null, 2)}\n`, "utf8");
  renameSync(temp, filePath);
  stamp.current = stampOf(statSync(filePath));
}

/**
 * The qa-accounts CLI runs in its own process against the same file. Re-read
 * it whenever it changed on disk, before every read or read-modify-write:
 * without this a running Host would keep honoring tokens the CLI revoked
 * and its next save would resurrect the CLI's change from a stale snapshot.
 * One file, one writer at a time remains the deployment's discipline; LAN
 * scale keeps the stat per operation trivial.
 *
 * Returns the freshly loaded file, or undefined when the caller should keep
 * serving its in-memory state.
 */
export function reloadAccountsFileIfChanged(
  filePath: string,
  stamp: FileStampRef,
): AccountsFile | undefined {
  let stat: Stats;
  try {
    stat = statSync(filePath);
  } catch {
    // The file vanished between operations (never by our hand): keep
    // serving the in-memory state instead of resetting every account.
    return undefined;
  }
  if (
    stat.mtimeMs === stamp.current.mtimeMs &&
    stat.size === stamp.current.size
  ) {
    return undefined;
  }
  return loadAccountsFile(filePath, stamp);
}
