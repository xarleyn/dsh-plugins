import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type {
  QaAccountIdentityField,
  QaAccountProfile,
  QaAccountProfileInput,
  QaAccountRole,
  QaAccountSession,
  QaAccountStartersInput,
  QaAccountUserPublic,
  QaAccessUser,
  QaAdminAccountRow,
  QaClaimResult,
  QaEffectiveCapabilityPolicy,
  QaOwnershipEntry,
  QaIssuedServiceToken,
  QaServiceTokenSummary,
  QaSkillActivationRecord,
  QaUserAccess,
  QaWhoamiResult,
} from "../types.js";
import {
  QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX,
  normalizeProfile,
  validateProfileWrite,
} from "../profile.js";
import { normalizeStarters, validateStartersWrite } from "../starters.js";
import { validateCredentials, validatePassword } from "./credentials.js";
import { QaAccountsDatabase } from "./database.js";
import { QaAccountsError } from "./errors.js";
import {
  defaultAccountsFilePath,
  type AccountsFile,
  type StoredOwnership,
  type StoredUser,
} from "./file.js";
import {
  mintServiceToken,
  normalizeServiceTokenScopes,
  parseServiceToken,
  QA_SERVICE_TOKEN_DEFAULT_SCOPES,
  QA_SERVICE_TOKEN_LABEL_MAX,
  QA_SERVICE_TOKEN_TTL_DAYS_MAX,
  QA_SERVICE_TOKEN_TTL_DAYS_MIN,
  serviceTokenMatches,
  type QaServiceTokenScope,
} from "./service-token.js";
import { mintToken, verifyToken } from "./token.js";

export { QaAccountsError } from "./errors.js";
export type { QaAccountsErrorReason } from "./errors.js";
export { defaultAccountsFilePath } from "./file.js";
// The read shapes are declared with the other wire types, because the client
// bundle renders them too; they stay re-exported here for the operator CLI.
export type {
  QaIssuedServiceToken,
  QaServiceTokenSummary,
} from "../types.js";

export interface QaAccountsOptions {
  readonly sessionTtlDays: number;
  readonly allowRegistration: boolean;
  /** Login/registration attempts accepted per rolling minute, store-wide. */
  readonly maxAuthAttemptsPerMinute?: number;
  /** Character cap on a stored profile's agent guidance. */
  readonly instructionsMaxLength?: number;
  /**
   * Fields the deployment declares. Self-service writes may name only these;
   * omitting the list (the operator CLI) checks the key shape alone.
   */
  readonly identityFields?: readonly QaAccountIdentityField[];
  /**
   * Where a pre-SQLite accounts file may still live. Defaults to the `.json`
   * sibling of the database; pass an explicit path when a deployment kept it
   * somewhere else.
   */
  readonly legacyFilePath?: string;
}

/** Keep a requested lifetime inside the supported range. */
function clampServiceTokenTtl(days: number): number {
  if (!Number.isFinite(days)) return QA_SERVICE_TOKEN_TTL_DAYS_MIN;
  return Math.min(
    QA_SERVICE_TOKEN_TTL_DAYS_MAX,
    Math.max(QA_SERVICE_TOKEN_TTL_DAYS_MIN, Math.round(days)),
  );
}

/** The `.json` sibling of a `.db` path: what a deployment upgraded from. */
function legacySiblingOf(filePath: string): string | undefined {
  return filePath.endsWith(".db")
    ? `${filePath.slice(0, -".db".length)}.json`
    : undefined;
}

/**
 * Where the database and a pre-SQLite file live, given the path an operator
 * configured.
 *
 * A `.json` path is the file a pre-SQLite release wrote, so the database lands
 * beside it as `.db` and that file is imported: passing the old filename must
 * neither start an empty store nor truncate the file that holds the accounts.
 */
function resolveAccountsPaths(
  configured: string,
  explicitLegacy: string | undefined,
): { databasePath: string; legacyFilePath: string | undefined } {
  if (configured.endsWith(".json")) {
    return {
      databasePath: `${configured.slice(0, -".json".length)}.db`,
      legacyFilePath: explicitLegacy ?? configured,
    };
  }
  return {
    databasePath: configured,
    legacyFilePath: explicitLegacy ?? legacySiblingOf(configured),
  };
}

/**
 * What the caller knows about the live session it is gating. The store is
 * file-backed and session-agnostic; the Host supplies these facts so the
 * first-come auto-claim can refuse what it must not attach silently. Absent
 * facts (the operator CLI, a session the Host has not materialized) keep the
 * historical unbounded claim.
 */
export interface QaSessionFacts {
  /** Epoch ms the Host recorded as the session's creation. */
  readonly createdAt?: number;
  /** True when the session is a delegated child of another chat. */
  readonly hasParent?: boolean;
}

const SCRYPT_KEY_LENGTH = 32;
const MAX_CLAIM_BATCH = 50;
const MAX_SESSION_ID_LENGTH = 200;

/** What a caller asks for when it mints an integration token. */
export interface QaServiceTokenIssueInput {
  /** A note for the operator's token list; empty becomes a generic label. */
  readonly label?: string;
  /** Requested scopes; unknown ones are dropped, empty falls back to `ask`. */
  readonly scopes?: readonly string[];
  /** How long the token lives; bounded, and the session TTL when omitted. */
  readonly ttlDays?: number;
  /**
   * The account the token belongs to. An administrator may name somebody
   * else; everybody else is refused, so an integration credential is always
   * issued with an explicit owner.
   */
  readonly userId?: string;
}

/** What a presented integration token resolved to. */
export interface QaVerifiedServiceToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly scopes: readonly QaServiceTokenScope[];
}

/**
 * How long an unowned session stays claimable at access time. Mirrors the
 * admission bootstrap window: a session older than this has either user
 * history or a settled composition, so silently attaching it to whoever
 * asked first would hand over a conversation nobody assigned to them.
 * Owners are unaffected — their claim already exists in the file.
 */
export const QA_SESSION_CLAIM_WINDOW_MS = 120_000;

const ACCOUNT_ROLES: readonly QaAccountRole[] = ["admin", "reviewer", "user"];

/** Wire-safe role guard: the browser sends a string, not the union. */
function isAccountRole(value: unknown): value is QaAccountRole {
  return (
    typeof value === "string" && ACCOUNT_ROLES.includes(value as QaAccountRole)
  );
}

function toPublic(user: StoredUser): QaAccountUserPublic {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    disabled: user.disabled === true,
    profile: normalizeProfile(user.profile),
    starters: normalizeStarters(user.starters),
  };
}

function hashPassword(password: string): StoredUser["passwordHash"] {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

function passwordMatches(
  password: string,
  stored: StoredUser["passwordHash"],
): boolean {
  const expected = Buffer.from(stored.hash, "hex");
  const actual = scryptSync(
    password,
    Buffer.from(stored.salt, "hex"),
    expected.length,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Host authority for QA accounts: the account list, the session ownership map
 * and the HMAC account tokens. Mutations are synchronous and land as the rows
 * they change, in one transaction each.
 *
 * The class is the facade: token mechanics live in token.ts, the tables and the
 * legacy import in database.ts, and the credential rules shared by registration
 * and the operator CLI in credentials.ts.
 */
export class QaAccounts {
  /** The database this store reads and writes. */
  readonly filePath: string;
  private file: AccountsFile;
  private readonly authAttempts: number[] = [];
  private readonly maxAuthAttemptsPerMinute: number;
  private readonly sessionTtlDays: number;
  private readonly allowRegistration: boolean;
  /** Character cap on a stored profile's agent guidance. */
  private readonly instructionsMaxLength: number;
  /** Whether a deployment declares which identity handles an account may hold. */
  readonly identityFields: readonly QaAccountIdentityField[] | undefined;
  /**
   * The store's tables. Every mutation writes the rows it changes and the
   * in-memory model is refreshed only when another process wrote — which is
   * what keeps the cost of opening a chat independent of the deployment's age.
   */
  private readonly database: QaAccountsDatabase;

  constructor(
    configuredPath: string = defaultAccountsFilePath(),
    options: QaAccountsOptions,
  ) {
    this.sessionTtlDays = options.sessionTtlDays;
    this.allowRegistration = options.allowRegistration;
    this.maxAuthAttemptsPerMinute = options.maxAuthAttemptsPerMinute ?? 30;
    this.instructionsMaxLength =
      options.instructionsMaxLength ?? QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX;
    this.identityFields = options.identityFields;
    const paths = resolveAccountsPaths(configuredPath, options.legacyFilePath);
    this.filePath = paths.databasePath;
    this.database = new QaAccountsDatabase(paths.databasePath);
    try {
      // A deployment upgrading from the JSON store keeps its accounts: the
      // file is imported, verified and renamed aside before anything else runs.
      this.database.importLegacyFile(paths.legacyFilePath);
      this.file = this.database.loadAll();
    } catch (error) {
      // A store that cannot start must not hold the database open: the caller
      // may retry, and a held handle blocks cleaning up after the failure.
      this.database.close();
      throw error;
    }
  }

  /** Close the underlying database; the store is unusable afterwards. */
  close(): void {
    this.database.close();
  }

  /**
   * Re-read the model when another process wrote the database, before every
   * read or read-modify-write. The `qa-accounts` CLI runs in its own process
   * against the same file, so without this a running Host would keep honoring
   * tokens the CLI revoked. SQLite bumps `PRAGMA data_version` exactly when a
   * *different* connection commits, which is the probe the previous
   * mtime-and-size stamp of the JSON file used to provide.
   */
  private reloadIfChanged(): void {
    if (this.database.unchangedSinceLoad) return;
    this.file = this.database.loadAll();
  }

  private pruneAuthAttempts(): void {
    const cutoff = Date.now() - 60_000;
    let stale = 0;
    for (const at of this.authAttempts) {
      if (at >= cutoff) break;
      stale += 1;
    }
    if (stale > 0) this.authAttempts.splice(0, stale);
  }

  private assertAuthBudget(): void {
    this.pruneAuthAttempts();
    if (this.authAttempts.length >= this.maxAuthAttemptsPerMinute) {
      throw new QaAccountsError(
        "rate-limited",
        "too many authentication attempts; retry in a minute",
      );
    }
    this.authAttempts.push(Date.now());
  }

  private userByEmail(email: string): StoredUser | undefined {
    return this.file.users.find((user) => user.email === email);
  }

  register(
    email: string,
    password: string,
    displayName?: string,
  ): QaAccountSession {
    this.reloadIfChanged();
    this.assertAuthBudget();
    if (!this.allowRegistration) {
      throw new QaAccountsError(
        "registration-disabled",
        "self-registration is disabled on this deployment",
      );
    }
    const { email: normalized, displayName: name } = validateCredentials(
      email,
      password,
      displayName,
    );
    if (this.userByEmail(normalized) !== undefined) {
      throw new QaAccountsError(
        "email-taken",
        "this email is already registered",
      );
    }
    // The first account boots the deployment's admin; later ones are users.
    const role: QaAccountRole = this.file.users.length === 0 ? "admin" : "user";
    const user: StoredUser = {
      id: randomUUID(),
      email: normalized,
      displayName:
        name === "" ? (normalized.split("@")[0] ?? normalized) : name,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      tokenVersion: 0,
    };
    this.database.insertUser(user);
    this.file = { ...this.file, users: [...this.file.users, user] };
    return { token: this.mintToken(user.id), user: toPublic(user) };
  }

  login(email: string, password: string): QaAccountSession {
    this.reloadIfChanged();
    this.assertAuthBudget();
    const user = this.userByEmail(email.trim().toLowerCase());
    // One message for unknown email and wrong password, both scrypt-checked
    // in the known-user path so the timing does not enumerate addresses.
    if (user === undefined) {
      passwordMatches(password, hashPassword(password));
      throw new QaAccountsError(
        "invalid-credentials",
        "email or password is incorrect",
      );
    }
    if (!passwordMatches(password, user.passwordHash)) {
      throw new QaAccountsError(
        "invalid-credentials",
        "email or password is incorrect",
      );
    }
    if (user.disabled === true) {
      throw new QaAccountsError(
        "account-disabled",
        "this account has been disabled by the operator",
      );
    }
    user.lastLoginAt = new Date().toISOString();
    this.database.touchLogin(user.id, user.lastLoginAt);
    return { token: this.mintToken(user.id), user: toPublic(user) };
  }

  whoami(token: string): QaWhoamiResult {
    this.reloadIfChanged();
    const userId = this.verifyToken(token);
    if (userId === null) return { authenticated: false };
    const user = this.file.users.find((candidate) => candidate.id === userId);
    return user === undefined || user.disabled === true
      ? { authenticated: false }
      : { authenticated: true, user: toPublic(user) };
  }

  /** Resolve a token to its user, or null for absent/invalid/expired ones. */
  verifyToken(token: string): string | null {
    // Signature, expiry and token-version mechanics live in token.ts.
    return verifyToken(this.file.secret, token, this.file.users);
  }

  private mintToken(userId: string): string {
    const user = this.file.users.find((candidate) => candidate.id === userId);
    return mintToken(this.file.secret, {
      uid: userId,
      exp: Date.now() + this.sessionTtlDays * 86_400_000,
      ver: user?.tokenVersion ?? 0,
    });
  }

  /** The account behind a token, or an auth-required refusal. */
  requireUser(token: string): StoredUser {
    const userId = this.verifyToken(token);
    const user =
      userId === null
        ? undefined
        : this.file.users.find((candidate) => candidate.id === userId);
    if (user === undefined || user.disabled === true) {
      throw new QaAccountsError(
        "auth-required",
        "a valid QA account token is required",
      );
    }
    return user;
  }

  /** Public identity behind a token; used by server-side access services. */
  currentUser(token: string): QaAccountUserPublic {
    this.reloadIfChanged();
    return toPublic(this.requireUser(token));
  }

  /**
   * Ownership gate for one session: claim unowned sessions for the requesting
   * user (first come, first served — the pre-accounts migration path), refuse
   * foreign sessions unless the caller administers the deployment.
   *
   * The auto-claim is bounded when the caller can describe the live session
   * ({@link QaSessionFacts}): a delegated subagent session is never claimed,
   * and a session past the freshness window is refused instead of silently
   * attached to whoever opened it first. Both refusals keep the file intact —
   * the session stays unowned, so the operator CLI or a deliberate future
   * claim can still resolve it.
   */
  ensureSessionAccess(
    token: string,
    sessionId: string,
    facts?: QaSessionFacts,
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    const owner = this.file.ownership[sessionId];
    if (owner === undefined) {
      if (facts?.hasParent === true) {
        throw new QaAccountsError(
          "session-owned-elsewhere",
          "a delegated subagent session has no QA owner",
        );
      }
      if (
        facts?.createdAt !== undefined &&
        Date.now() - facts.createdAt > QA_SESSION_CLAIM_WINDOW_MS
      ) {
        throw new QaAccountsError(
          "session-owned-elsewhere",
          "an established session is not claimed automatically",
        );
      }
      if (facts?.createdAt === undefined) {
        // The session header is unknown — the session is not materialized in
        // this Host process, so a delegated child from a previous run cannot
        // be told apart from a fresh chat. Grant provisional access without
        // recording ownership; admission re-runs this check once the session
        // is live and its header is known.
        return toPublic(user);
      }
      const claimed: StoredOwnership = {
        userId: user.id,
        claimedAt: new Date().toISOString(),
      };
      this.database.insertOwnership(sessionId, claimed);
      this.file = {
        ...this.file,
        ownership: { ...this.file.ownership, [sessionId]: claimed },
      };
      return toPublic(user);
    }
    if (owner.userId !== user.id && user.role !== "admin") {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this session belongs to another QA user",
      );
    }
    const ownerUser = this.file.users.find(
      (candidate) => candidate.id === owner.userId,
    );
    if (ownerUser === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "the session owner no longer exists",
      );
    }
    return toPublic(ownerUser);
  }

  /**
   * Atomically reserve a Host-generated session id for the token user before
   * the Session exists. Browser callers therefore never get a race window in
   * which they can claim another user's newly created chat.
   */
  reserveSession(
    token: string,
    sessionId: string,
    access?: { readonly subroleId: string; readonly adminPreview?: boolean },
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    return this.reserveSessionForUser(
      toPublic(this.requireUser(token)),
      sessionId,
      access,
    );
  }

  /**
   * The same reservation for an account resolved by another credential.
   *
   * The caller has authenticated the account already — the integration API
   * checks its service token before it gets here — so this entry point takes
   * the account rather than a token. It is deliberately not reachable from a
   * remote: nothing a browser can send may name somebody else's account.
   *
   * @param user - the authenticated account the chat belongs to.
   * @param sessionId - the Host-generated session id to reserve.
   * @param access - the pinned subrole and preview flag, when the path has them.
   * @returns the account, as the token-shaped entry returns it.
   */
  reserveSessionForUser(
    user: QaAccountUserPublic,
    sessionId: string,
    access?: { readonly subroleId: string; readonly adminPreview?: boolean },
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    if (
      sessionId.trim() === "" ||
      sessionId.length > MAX_SESSION_ID_LENGTH ||
      this.file.ownership[sessionId] !== undefined
    ) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "the requested session id is unavailable",
      );
    }
    const reserved: StoredOwnership = {
      userId: user.id,
      claimedAt: new Date().toISOString(),
      ...(access === undefined ? {} : { subroleId: access.subroleId }),
      ...(access?.adminPreview === true ? { adminPreview: true } : {}),
    };
    this.database.insertOwnership(sessionId, reserved);
    this.file = {
      ...this.file,
      ownership: { ...this.file.ownership, [sessionId]: reserved },
    };
    return user;
  }

  /** Roll back a reservation if Host creation failed before a chat existed. */
  releaseSessionReservation(userId: string, sessionId: string): void {
    this.reloadIfChanged();
    if (this.file.ownership[sessionId]?.userId !== userId) return;
    this.database.deleteOwnership([sessionId]);
    const ownership = { ...this.file.ownership };
    delete ownership[sessionId];
    this.file = { ...this.file, ownership };
  }

  /** Bulk-claim a browser's local chat index; foreign ids come back as conflicts. */
  claimSessions(token: string, sessionIds: readonly string[]): QaClaimResult {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    if (sessionIds.length > MAX_CLAIM_BATCH) {
      throw new QaAccountsError("auth-required", "claim batch is too large");
    }
    let claimed = 0;
    const conflicts: string[] = [];
    const ownership = { ...this.file.ownership };
    const claims: { sessionId: string; owner: StoredOwnership }[] = [];
    const claimedAt = new Date().toISOString();
    for (const raw of sessionIds) {
      const sessionId = typeof raw === "string" ? raw.trim() : "";
      if (sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH)
        continue;
      const owner = ownership[sessionId];
      if (owner === undefined) {
        const claim: StoredOwnership = { userId: user.id, claimedAt };
        ownership[sessionId] = claim;
        claims.push({ sessionId, owner: claim });
        claimed += 1;
      } else if (owner.userId !== user.id) {
        conflicts.push(sessionId);
      }
    }
    if (claimed > 0) {
      this.database.insertOwnershipMany(claims);
      this.file = { ...this.file, ownership };
    }
    return { claimed, conflicts };
  }

  /** Session ids owned by the token's user, most recently claimed first. */
  ownedSessionIds(token: string): readonly string[] {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    return Object.entries(this.file.ownership)
      .filter(([, owner]) => owner.userId === user.id)
      .sort((left, right) =>
        right[1].claimedAt.localeCompare(left[1].claimedAt),
      )
      .map(([sessionId]) => sessionId);
  }

  /**
   * Drop ownership records of sessions that are not chats at all.
   *
   * A delegated subagent session is an implementation detail of one answer:
   * nothing legitimately owns one, so no grace period applies and every named
   * id loses its record. Only ids the caller positively identified are
   * touched — a record is an auth boundary, and an id that merely looks odd
   * keeps its owner. What this reclaims is residue: records written before the
   * claim and attestation paths learned to refuse a delegated child, each one
   * keeping a subagent's session in some account's chat list.
   *
   * @param sessionIds - the ids the caller identified as delegated children.
   * @returns the session ids whose records were dropped.
   */
  pruneDelegatedOwnership(sessionIds: ReadonlySet<string>): readonly string[] {
    return this.forgetSessions(sessionIds);
  }

  /**
   * Drop the ownership records of the named sessions, whatever their lineage.
   *
   * This is the record half of a deletion: the caller has already established
   * that these sessions are gone (or is removing them as part of the same
   * act), so the auth boundary goes with them. Nothing here decides anything —
   * the sweeps above own the judgments, and both end in this.
   *
   * @param sessionIds - the ids whose records are dropped.
   * @returns the session ids whose records were actually there.
   */
  forgetSessions(sessionIds: ReadonlySet<string>): readonly string[] {
    this.reloadIfChanged();
    const removed = Object.keys(this.file.ownership).filter((sessionId) =>
      sessionIds.has(sessionId),
    );
    if (removed.length === 0) return removed;
    this.database.deleteOwnership(removed);
    const ownership = { ...this.file.ownership };
    for (const sessionId of removed) delete ownership[sessionId];
    this.file = { ...this.file, ownership };
    return removed;
  }

  /**
   * Drop ownership records for chats the Harness no longer knows.
   *
   * An ownership record is a chat's auth boundary — `ensureSessionAccess`
   * claims an unowned session for whoever asks first — so a record is removed
   * only when the caller reports the session gone *and* the claim is older
   * than `graceHours`. A reservation racing its own creation therefore keeps
   * its owner, and a live chat never becomes claimable by someone else. What
   * this reclaims is the residue of deleted chats, which nothing else removes.
   *
   * @param isLive - whether the Harness still knows this session.
   * @param graceHours - youngest claim the sweep may touch.
   * @returns the session ids whose records were dropped.
   */
  pruneVanishedSessions(
    isLive: (sessionId: string) => boolean,
    graceHours: number,
  ): readonly string[] {
    this.reloadIfChanged();
    const cutoff = Date.now() - graceHours * 3_600_000;
    const ownership: Record<string, StoredOwnership> = {};
    const removed: string[] = [];
    for (const [sessionId, owner] of Object.entries(this.file.ownership)) {
      const claimedAt = Date.parse(owner.claimedAt);
      if (
        Number.isFinite(claimedAt) &&
        claimedAt < cutoff &&
        !isLive(sessionId)
      ) {
        removed.push(sessionId);
        continue;
      }
      ownership[sessionId] = owner;
    }
    if (removed.length === 0) return removed;
    this.database.deleteOwnership(removed);
    this.file = { ...this.file, ownership };
    return removed;
  }

  /**
   * Every ownership entry with the owner's display name resolved at read
   * time, oldest claim first. Admin-only: this is the cross-user view the
   * admin sidebar groups chats by; ordinary accounts get a dedicated refusal.
   */
  listOwnership(token: string): readonly QaOwnershipEntry[] {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    if (user.role !== "admin") {
      throw new QaAccountsError(
        "admin-required",
        "listing chat ownership requires an admin account",
      );
    }
    const names = new Map(
      this.file.users.map((candidate) => [candidate.id, candidate.displayName]),
    );
    return Object.entries(this.file.ownership)
      .map(([sessionId, owner]) => ({
        sessionId,
        userId: owner.userId,
        displayName: names.get(owner.userId) ?? owner.userId,
        claimedAt: owner.claimedAt,
      }))
      .sort((left, right) => left.claimedAt.localeCompare(right.claimedAt));
  }

  // ---------------------------------------------------------------------------
  // Operator management surface (the qa-accounts CLI; never browser-callable).
  // ---------------------------------------------------------------------------

  /** Every account, file order; for `qa-accounts list`. */
  listUsers(): readonly {
    readonly email: string;
    readonly displayName: string;
    readonly role: QaAccountRole;
    readonly disabled: boolean;
    readonly createdAt: string;
    readonly lastLoginAt: string | null;
  }[] {
    this.reloadIfChanged();
    return this.file.users.map((user) => ({
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      disabled: user.disabled === true,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    }));
  }

  /** Browser-safe administration rows with capability assignments. */
  listAccessUsers(
    resolve: (stored: QaUserAccess | undefined) => QaUserAccess,
  ): readonly QaAccessUser[] {
    this.reloadIfChanged();
    return this.file.users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accessRole: user.role,
      disabled: user.disabled === true,
      access: resolve(user.qaAccess),
    }));
  }

  /**
   * Every account with the administrative columns the admin console renders:
   * identity, status, authorization role, assignment and the timestamps of the
   * account's own life. Credentials and token material are never projected.
   */
  listAdminUsers(
    resolve: (stored: QaUserAccess | undefined) => QaUserAccess,
  ): readonly QaAdminAccountRow[] {
    this.reloadIfChanged();
    return this.file.users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      fullName: normalizeProfile(user.profile).fullName,
      role: user.role,
      disabled: user.disabled === true,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      access: resolve(user.qaAccess),
    }));
  }

  /**
   * Identity columns of every account, without their capability assignment.
   * The console's name lookup: an audit row or a queue entry names an account
   * by id, and the table needs a label for it.
   */
  directory(): readonly {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly role: QaAccountRole;
    readonly disabled: boolean;
  }[] {
    this.reloadIfChanged();
    return this.file.users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      disabled: user.disabled === true,
    }));
  }

  /** One account's administrative row, or undefined for an unknown id. */
  adminUser(
    userId: string,
    resolve: (stored: QaUserAccess | undefined) => QaUserAccess,
  ): QaAdminAccountRow | undefined {
    return this.listAdminUsers(resolve).find((user) => user.id === userId);
  }

  /**
   * Every session reservation with its pinned role and capability snapshot.
   * This is the deployment's own conversation index: a QA chat exists here
   * from the moment its id is reserved, before any message is written.
   */
  listOwnershipRecords(): readonly {
    readonly sessionId: string;
    readonly userId: string;
    readonly claimedAt: string;
    readonly subroleId?: string;
    readonly adminPreview?: boolean;
    readonly capabilitySnapshot?: QaEffectiveCapabilityPolicy;
  }[] {
    this.reloadIfChanged();
    return Object.entries(this.file.ownership).map(([sessionId, owner]) => ({
      sessionId,
      userId: owner.userId,
      claimedAt: owner.claimedAt,
      ...(owner.subroleId === undefined ? {} : { subroleId: owner.subroleId }),
      ...(owner.adminPreview === true ? { adminPreview: true } : {}),
      ...(owner.capabilitySnapshot === undefined
        ? {}
        : { capabilitySnapshot: owner.capabilitySnapshot }),
    }));
  }

  /**
   * Replace one account's authorization role, addressed by stable id.
   *
   * The union is re-checked here even though the type names it: the value
   * arrives from the browser's admin console over the wire, and a role outside
   * the union would be stored as-is and then crash every later permission
   * check (`PERMISSIONS[role]` lookup) for that account.
   */
  setAccessRole(userId: string, role: QaAccountRole): QaAccountUserPublic {
    if (!isAccountRole(role)) {
      throw new QaAccountsError(
        "invalid-role",
        "role must be admin, reviewer or user",
      );
    }
    return toPublic(this.editUserById(userId, (user) => ({ ...user, role })));
  }

  /**
   * Disable or enable one account by id. Same semantics as the operator
   * {@link setUserDisabled}: disabling also invalidates every live token, and
   * enabling does not bring the old ones back.
   */
  setAccessDisabled(userId: string, disabled: boolean): QaAccountUserPublic {
    return toPublic(
      this.editUserById(userId, (user) => {
        const next = user;
        if (disabled) {
          next.disabled = true;
          next.tokenVersion = (next.tokenVersion ?? 0) + 1;
        } else {
          delete next.disabled;
        }
        return next;
      }),
    );
  }

  /** Stored assignment for one account; callers normalize missing legacy rows. */
  accessOf(userId: string): QaUserAccess | undefined {
    this.reloadIfChanged();
    return this.file.users.find((candidate) => candidate.id === userId)
      ?.qaAccess;
  }

  /** Admin-owned assignment write addressed by stable account id. */
  setAccess(userId: string, access: QaUserAccess): QaUserAccess {
    this.reloadIfChanged();
    const index = this.file.users.findIndex(
      (candidate) => candidate.id === userId,
    );
    if (index === -1) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    const users = [...this.file.users];
    users[index] = { ...(users[index] as StoredUser), qaAccess: access };
    this.database.updateUser(users[index] as StoredUser);
    this.file = { ...this.file, users };
    return access;
  }

  /** Persisted role and immutable policy record for one Host session. */
  sessionAccess(sessionId: string): StoredOwnership | undefined {
    this.reloadIfChanged();
    return this.file.ownership[sessionId];
  }

  /** Migrate a pre-subrole session or finalize its first policy snapshot. */
  updateSessionAccess(
    sessionId: string,
    update: {
      readonly subroleId?: string;
      readonly adminPreview?: boolean;
      readonly capabilitySnapshot?: QaEffectiveCapabilityPolicy;
    },
  ): StoredOwnership {
    this.reloadIfChanged();
    const current = this.file.ownership[sessionId];
    if (current === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "the session has no QA owner",
      );
    }
    const next: StoredOwnership = {
      ...current,
      ...(update.subroleId === undefined
        ? {}
        : { subroleId: update.subroleId }),
      ...(update.adminPreview === undefined
        ? {}
        : { adminPreview: update.adminPreview }),
      ...(update.capabilitySnapshot === undefined
        ? {}
        : { capabilitySnapshot: update.capabilitySnapshot }),
    };
    this.database.updateOwnership(sessionId, next);
    this.file = {
      ...this.file,
      ownership: { ...this.file.ownership, [sessionId]: next },
    };
    return next;
  }

  /**
   * Append one skill activation attempt to a session's history.
   *
   * The record is the reviewable half of a dynamic tool grant: it names what
   * the skill asked for, what it received and what it was refused. The list is
   * bounded, because a long session may activate skills many times and the
   * oldest entries stop being interesting long before the file does.
   * @param sessionId - the session the activation belongs to.
   * @param entry - the attempt to append.
   * @param limit - how many entries to keep, newest last.
   * @returns the stored history after the append.
   */
  recordSkillActivation(
    sessionId: string,
    entry: QaSkillActivationRecord,
    limit: number,
  ): readonly QaSkillActivationRecord[] {
    this.reloadIfChanged();
    const current = this.file.ownership[sessionId];
    if (current === undefined) {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "the session has no QA owner",
      );
    }
    const skillActivations = this.database.appendSkillActivation(
      sessionId,
      entry,
      limit,
    );
    this.file = {
      ...this.file,
      ownership: {
        ...this.file.ownership,
        [sessionId]: { ...current, skillActivations },
      },
    };
    return skillActivations;
  }

  /** Create an account outside the self-registration gate. */
  addUser(
    email: string,
    password: string,
    options: { displayName?: string; role?: QaAccountRole } = {},
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    this.assertAuthBudget();
    const { email: normalized, displayName: name } = validateCredentials(
      email,
      password,
      options.displayName,
    );
    if (options.role !== undefined && !isAccountRole(options.role)) {
      throw new QaAccountsError(
        "invalid-role",
        "role must be admin, reviewer or user",
      );
    }
    if (this.userByEmail(normalized) !== undefined) {
      throw new QaAccountsError(
        "email-taken",
        "this email is already registered",
      );
    }
    const user: StoredUser = {
      id: randomUUID(),
      email: normalized,
      displayName:
        name === "" ? (normalized.split("@")[0] ?? normalized) : name,
      role: options.role ?? (this.file.users.length === 0 ? "admin" : "user"),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      tokenVersion: 0,
    };
    this.database.insertUser(user);
    this.file = { ...this.file, users: [...this.file.users, user] };
    return toPublic(user);
  }

  private editUser(
    email: string,
    edit: (user: StoredUser) => StoredUser,
  ): StoredUser {
    this.reloadIfChanged();
    const normalized = email.trim().toLowerCase();
    const index = this.file.users.findIndex(
      (user) => user.email === normalized,
    );
    if (index === -1) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    const updated = edit(this.file.users[index] as StoredUser);
    const users = [...this.file.users];
    users[index] = updated;
    this.database.updateUser(updated);
    this.file = { ...this.file, users };
    return updated;
  }

  /**
   * Same read-modify-write as {@link editUser}, addressed by account id. The
   * administrative console works in ids: an email is a credential-shaped
   * handle the operator may change, while the id is what conversations,
   * feedback and audit rows already reference.
   */
  private editUserById(
    userId: string,
    edit: (user: StoredUser) => StoredUser,
  ): StoredUser {
    this.reloadIfChanged();
    const index = this.file.users.findIndex((user) => user.id === userId);
    if (index === -1) {
      throw new QaAccountsError("invalid-credentials", "no such account");
    }
    const updated = edit(this.file.users[index] as StoredUser);
    const users = [...this.file.users];
    users[index] = updated;
    this.database.updateUser(updated);
    this.file = { ...this.file, users };
    return updated;
  }

  /** Grant or revoke the admin role. */
  setUserRole(email: string, role: QaAccountRole): QaAccountUserPublic {
    return toPublic(this.editUser(email, (user) => ({ ...user, role })));
  }

  /**
   * Replace an account's password, which is what a forgotten one needs. The
   * token version bumps with it, so every token minted under the old password
   * dies server-side: a reset is also the response to a leaked credential.
   * Ownership, profile and the account id survive, so the user's chats are
   * still theirs after signing in again.
   */
  setPassword(email: string, password: string): QaAccountUserPublic {
    validatePassword(password);
    return toPublic(
      this.editUser(email, (user) => ({
        ...user,
        passwordHash: hashPassword(password),
        tokenVersion: (user.tokenVersion ?? 0) + 1,
      })),
    );
  }

  /**
   * Disable an account: future logins are refused and every live token is
   * invalidated (the token version bumps). `enable` does not resurrect old
   * tokens — the account signs in again.
   */
  setUserDisabled(email: string, disabled: boolean): QaAccountUserPublic {
    return toPublic(
      this.editUser(email, (user) => {
        const next = user;
        if (disabled) {
          next.disabled = true;
          next.tokenVersion = (next.tokenVersion ?? 0) + 1;
        } else {
          delete next.disabled;
        }
        return next;
      }),
    );
  }

  /** Invalidate every token of the account (password-leak response). */
  revokeTokens(email: string): QaAccountUserPublic {
    const user = this.editUser(email, (candidate) => ({
      ...candidate,
      tokenVersion: (candidate.tokenVersion ?? 0) + 1,
    }));
    // "Revoke every token" has to include the integration ones. A browser
    // token answer cannot cover them — they carry no token version on purpose,
    // so that a human changing their password does not log out a service —
    // and leaving them live would make the operator's leak response a lie.
    this.database.revokeServiceTokensOf(user.id, new Date().toISOString());
    return toPublic(user);
  }

  // ---------------------------------------------------------------------------
  // Integration tokens: a second, long-lived credential for the QA HTTP API.
  //
  // They are read straight from the database rather than from the in-memory
  // `AccountsFile` model. Two reasons: the model is the accounts document and
  // growing it with a table of its own would make every chat claim carry token
  // digests, and a token is looked up by primary key, which the database does
  // without loading anything else. Cross-process revocations therefore take
  // effect on the next request, not on the next model reload.
  // ---------------------------------------------------------------------------

  /**
   * Mint one integration token for an account.
   *
   * The caller may mint for itself; naming somebody else is an administrative
   * act and carries the same check as every other cross-account operation.
   *
   * @param token - the caller's browser token.
   * @param input - label, scopes, lifetime and the optional target account.
   * @returns the token with the scopes and expiry that were actually granted.
   */
  mintServiceToken(
    token: string,
    input: QaServiceTokenIssueInput = {},
  ): QaIssuedServiceToken {
    this.reloadIfChanged();
    const caller = this.requireUser(token);
    let target = caller;
    if (input.userId !== undefined && input.userId !== caller.id) {
      this.requireAdmin(
        caller,
        "mint an integration token for another account",
      );
      const named = this.file.users.find(
        (candidate) => candidate.id === input.userId,
      );
      if (named === undefined || named.disabled === true) {
        throw new QaAccountsError(
          "forbidden",
          "the named account does not exist",
        );
      }
      target = named;
    }
    return this.mintServiceTokenFor(toPublic(target), input);
  }

  /**
   * Mint one integration token for an account the caller has established.
   *
   * The operator CLI takes this path: it runs in its own process, against the
   * accounts database, with the deployment's file access as its only
   * authority — there is no browser token to present. The browser path above
   * keeps its own check, so nothing a page can send reaches this entry point.
   *
   * @param target - the account the credential belongs to.
   * @param input - label, scopes and lifetime.
   * @returns the token, with the plaintext shown exactly once.
   */
  mintServiceTokenFor(
    target: QaAccountUserPublic,
    input: QaServiceTokenIssueInput = {},
  ): QaIssuedServiceToken {
    this.reloadIfChanged();
    const scopes = normalizeServiceTokenScopes(
      input.scopes ?? QA_SERVICE_TOKEN_DEFAULT_SCOPES,
    );
    const ttlDays = clampServiceTokenTtl(input.ttlDays ?? this.sessionTtlDays);
    const minted = mintServiceToken();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
    const label = (input.label ?? "")
      .trim()
      .slice(0, QA_SERVICE_TOKEN_LABEL_MAX);
    this.database.insertServiceToken({
      id: minted.tokenId,
      userId: target.id,
      label: label === "" ? "integration" : label,
      hash: minted.hash,
      scopes,
      createdAt,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      useCount: 0,
    });
    return Object.freeze({
      id: minted.tokenId,
      token: minted.token,
      label: label === "" ? "integration" : label,
      scopes,
      createdAt,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      useCount: 0,
    });
  }

  /**
   * Verify a presented integration token.
   *
   * Every refusal is the same null: unknown id, bad secret, expired, revoked,
   * disabled account. An unauthenticated caller must not learn which of those
   * it hit, and a caller holding a stale token does not need to.
   *
   * @param presented - the raw credential from the request.
   * @returns the token's identity, or null.
   */
  verifyServiceToken(presented: string): QaVerifiedServiceToken | null {
    const parsed = parseServiceToken(presented);
    if (parsed === null) return null;
    const record = this.database.serviceToken(parsed.tokenId);
    if (record === undefined) return null;
    if (!serviceTokenMatches(parsed.secret, record.hash)) return null;
    if (record.revokedAt !== null) return null;
    if (Date.parse(record.expiresAt) <= Date.now()) return null;
    this.reloadIfChanged();
    const user = this.file.users.find(
      (candidate) => candidate.id === record.userId,
    );
    if (user === undefined || user.disabled === true) return null;
    // Usage is what makes an unused credential visible in the operator's
    // list; the write is one indexed row, and the timestamp is also what the
    // audit trail needs when a question is traced back to a caller.
    this.database.touchServiceToken(record.id, new Date().toISOString());
    return Object.freeze({
      tokenId: record.id,
      userId: record.userId,
      scopes: normalizeServiceTokenScopes(record.scopes),
    });
  }

  /**
   * The caller's own integration tokens, newest last.
   * @param token - the caller's browser token.
   * @returns summaries; the secrets are not recoverable and are not listed.
   */
  listServiceTokens(token: string): readonly QaServiceTokenSummary[] {
    this.reloadIfChanged();
    return this.listServiceTokensFor(toPublic(this.requireUser(token)));
  }

  /** The integration tokens of an account the caller has established. */
  listServiceTokensFor(
    user: QaAccountUserPublic,
  ): readonly QaServiceTokenSummary[] {
    return Object.freeze(
      this.database.serviceTokensOf(user.id).map((record) =>
        Object.freeze({
          id: record.id,
          label: record.label,
          scopes: normalizeServiceTokenScopes(record.scopes),
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          lastUsedAt: record.lastUsedAt,
          revokedAt: record.revokedAt,
          useCount: record.useCount,
        }),
      ),
    );
  }

  /**
   * Revoke one of the caller's own integration tokens.
   * @param token - the caller's browser token.
   * @param tokenId - the token to revoke.
   * @returns true when a live token was revoked.
   */
  revokeServiceToken(token: string, tokenId: string): boolean {
    this.reloadIfChanged();
    return this.revokeServiceTokenFor(
      toPublic(this.requireUser(token)),
      tokenId,
    );
  }

  /** Revoke one integration token of an account the caller has established. */
  revokeServiceTokenFor(user: QaAccountUserPublic, tokenId: string): boolean {
    const record = this.database.serviceToken(tokenId);
    if (record === undefined || record.userId !== user.id) {
      // Same answer for "no such token" and "not yours": the id alone must
      // not confirm that another account's credential exists.
      throw new QaAccountsError(
        "forbidden",
        "the integration token does not belong to this account",
      );
    }
    return this.database.revokeServiceToken(tokenId, new Date().toISOString());
  }

  /** The caller if it administers the deployment, or a refusal. */
  private requireAdmin(user: StoredUser, action: string): StoredUser {
    if (user.role !== "admin") {
      throw new QaAccountsError(
        "admin-required",
        `an administrator is required to ${action}`,
      );
    }
    return user;
  }

  // ---------------------------------------------------------------------------
  // Self-declared profiles: what the QA prompt says about the current user.
  // ---------------------------------------------------------------------------

  /**
   * The account that owns one session, or undefined while nobody claimed it.
   * The prompt renderer resolves a chat's owner through this map, so a session
   * that predates accounts simply carries no identity.
   */
  ownerIdOf(sessionId: string): string | undefined {
    this.reloadIfChanged();
    return this.file.ownership[sessionId]?.userId;
  }

  /**
   * Email plus profile of one account, for the prompt renderer. A disabled
   * account resolves to nothing: its identity leaves the prompt together with
   * its access, so a revoked user is no longer addressed by name.
   */
  identityOf(
    userId: string,
  ):
    { readonly email: string; readonly profile: QaAccountProfile } | undefined {
    this.reloadIfChanged();
    const user = this.file.users.find((candidate) => candidate.id === userId);
    if (user === undefined || user.disabled === true) return undefined;
    return { email: user.email, profile: normalizeProfile(user.profile) };
  }

  /** One account in its public shape; undefined when the address is unknown. */
  /**
   * One account's public identity by id.
   *
   * Host paths that authenticated the account themselves — the integration
   * API, which resolves its own service token — need the public shape the
   * token-shaped entries return, without a browser token to hand.
   */
  accountById(userId: string): QaAccountUserPublic | undefined {
    this.reloadIfChanged();
    const user = this.file.users.find((candidate) => candidate.id === userId);
    return user === undefined || user.disabled === true
      ? undefined
      : toPublic(user);
  }

  findUser(email: string): QaAccountUserPublic | undefined {
    this.reloadIfChanged();
    const user = this.userByEmail(email.trim().toLowerCase());
    return user === undefined ? undefined : toPublic(user);
  }

  /**
   * Operator write: replace one account's profile, addressed by email. The
   * CLI merges field-level flags into a full profile before calling this.
   */
  setProfile(email: string, input: QaAccountProfileInput): QaAccountUserPublic {
    return toPublic(
      this.editUser(email, (user) => this.stampedProfile(user, input)),
    );
  }

  /**
   * Self-service write for the token's own account. The token is verified
   * first, so a browser can only ever edit the profile it is signed in as.
   */
  updateOwnProfile(
    token: string,
    input: QaAccountProfileInput,
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    return this.setProfile(user.email, input);
  }

  /**
   * Replace the token account's starter buttons. Same self-service shape as
   * {@link updateOwnProfile}: the token is the only identity, and a rejected
   * write leaves the stored record untouched.
   */
  updateOwnStarters(
    token: string,
    input: QaAccountStartersInput,
  ): QaAccountUserPublic {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    const result = validateStartersWrite(input);
    if (!result.ok) {
      throw new QaAccountsError("invalid-starters", result.message);
    }
    return toPublic(
      this.editUser(user.email, (current) => ({
        ...current,
        starters: {
          items: result.value.items.map((item) => ({ ...item })),
          hideDefaults: result.value.hideDefaults,
        },
      })),
    );
  }

  /**
   * Validate one profile write and stamp it onto the account. Throws before
   * anything is mutated, so a rejected write leaves the stored profile, and
   * the address it is keyed to, exactly as they were.
   */
  private stampedProfile(
    user: StoredUser,
    input: QaAccountProfileInput,
  ): StoredUser {
    const result = validateProfileWrite(input, {
      instructionsMaxLength: this.instructionsMaxLength,
      ...(this.identityFields === undefined
        ? {}
        : { identities: this.identityFields }),
    });
    if (!result.ok) {
      throw new QaAccountsError("invalid-profile", result.message);
    }
    return {
      ...user,
      profile: {
        fullName: result.value.fullName,
        identities: { ...result.value.identities },
        instructions: result.value.instructions,
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
