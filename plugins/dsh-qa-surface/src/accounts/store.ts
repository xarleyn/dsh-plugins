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
  QaAccountUserPublic,
  QaClaimResult,
  QaOwnershipEntry,
  QaWhoamiResult,
} from "../types.js";
import {
  QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX,
  normalizeProfile,
  validateProfileWrite,
} from "../profile.js";
import { validateCredentials } from "./credentials.js";
import { QaAccountsError } from "./errors.js";
import {
  createFileStampRef,
  defaultAccountsFilePath,
  loadAccountsFile,
  persistAccountsFile,
  reloadAccountsFileIfChanged,
} from "./file.js";
import type { AccountsFile, StoredUser } from "./file.js";
import { mintToken, verifyToken } from "./token.js";

export { QaAccountsError } from "./errors.js";
export type { QaAccountsErrorReason } from "./errors.js";
export { defaultAccountsFilePath } from "./file.js";

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
}

const SCRYPT_KEY_LENGTH = 32;
const MAX_CLAIM_BATCH = 50;
const MAX_SESSION_ID_LENGTH = 200;

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
 * Host authority for QA accounts: the file-backed user list, the session
 * ownership map and the HMAC account tokens. All mutations are synchronous
 * and persisted atomically (temp file + rename); LAN scale keeps this trivial.
 *
 * The class is the facade: token mechanics live in token.ts, the file format
 * and its atomic persistence plus the external-change probe in file.ts, and
 * the credential rules shared by registration and the operator CLI in
 * credentials.ts.
 */
export class QaAccounts {
  private file: AccountsFile;
  private readonly authAttempts: number[] = [];
  private readonly maxAuthAttemptsPerMinute: number;
  private readonly sessionTtlDays: number;
  private readonly allowRegistration: boolean;
  /** Character cap on a stored profile's agent guidance. */
  private readonly instructionsMaxLength: number;
  /** Declared handle fields; undefined lets an operator write any shape-valid key. */
  private readonly identityFields:
    readonly QaAccountIdentityField[] | undefined;
  /** mtime+size of the file as of the last load; the external-change probe. */
  private readonly fileStamp = createFileStampRef();

  constructor(
    readonly filePath: string = defaultAccountsFilePath(),
    options: QaAccountsOptions,
  ) {
    this.sessionTtlDays = options.sessionTtlDays;
    this.allowRegistration = options.allowRegistration;
    this.maxAuthAttemptsPerMinute = options.maxAuthAttemptsPerMinute ?? 30;
    this.instructionsMaxLength =
      options.instructionsMaxLength ?? QA_PROFILE_DEFAULT_INSTRUCTIONS_MAX;
    this.identityFields = options.identityFields;
    this.file = loadAccountsFile(this.filePath, this.fileStamp);
  }

  /**
   * Re-read the accounts file when it changed on disk, before every read or
   * read-modify-write. The probe itself and its cross-process rationale live
   * with the file layer (reloadAccountsFileIfChanged).
   */
  private reloadIfChanged(): void {
    const loaded = reloadAccountsFileIfChanged(this.filePath, this.fileStamp);
    if (loaded !== undefined) this.file = loaded;
  }

  private save(): void {
    persistAccountsFile(this.filePath, this.file, this.fileStamp);
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
    this.file = { ...this.file, users: [...this.file.users, user] };
    this.save();
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
    this.save();
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

  /**
   * Ownership gate for one session: claim unowned sessions for the requesting
   * user (first come, first served — the pre-accounts migration path), refuse
   * foreign sessions unless the caller administers the deployment.
   */
  ensureSessionAccess(token: string, sessionId: string): QaAccountUserPublic {
    this.reloadIfChanged();
    const user = this.requireUser(token);
    const owner = this.file.ownership[sessionId];
    if (owner === undefined) {
      this.file = {
        ...this.file,
        ownership: {
          ...this.file.ownership,
          [sessionId]: { userId: user.id, claimedAt: new Date().toISOString() },
        },
      };
      this.save();
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
  reserveSession(token: string, sessionId: string): QaAccountUserPublic {
    this.reloadIfChanged();
    const user = this.requireUser(token);
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
    this.file = {
      ...this.file,
      ownership: {
        ...this.file.ownership,
        [sessionId]: { userId: user.id, claimedAt: new Date().toISOString() },
      },
    };
    this.save();
    return toPublic(user);
  }

  /** Roll back a reservation if Host creation failed before a chat existed. */
  releaseSessionReservation(userId: string, sessionId: string): void {
    this.reloadIfChanged();
    if (this.file.ownership[sessionId]?.userId !== userId) return;
    const ownership = { ...this.file.ownership };
    delete ownership[sessionId];
    this.file = { ...this.file, ownership };
    this.save();
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
    for (const raw of sessionIds) {
      const sessionId = typeof raw === "string" ? raw.trim() : "";
      if (sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH)
        continue;
      const owner = ownership[sessionId];
      if (owner === undefined) {
        ownership[sessionId] = {
          userId: user.id,
          claimedAt: new Date().toISOString(),
        };
        claimed += 1;
      } else if (owner.userId !== user.id) {
        conflicts.push(sessionId);
      }
    }
    if (claimed > 0) {
      this.file = { ...this.file, ownership };
      this.save();
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
   * Every ownership entry with the owner's display name resolved at read
   * time, oldest claim first. Admin-only: this is the cross-user view the
   * admin sidebar groups chats by; ordinary accounts get a dedicated refusal.
   */
  listOwnership(token: string): readonly QaOwnershipEntry[] {
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
    if (
      options.role !== undefined &&
      options.role !== "admin" &&
      options.role !== "user"
    ) {
      throw new QaAccountsError("invalid-role", "role must be admin or user");
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
    this.file = { ...this.file, users: [...this.file.users, user] };
    this.save();
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
    this.file = { ...this.file, users };
    this.save();
    return updated;
  }

  /** Grant or revoke the admin role. */
  setUserRole(email: string, role: QaAccountRole): QaAccountUserPublic {
    return toPublic(this.editUser(email, (user) => ({ ...user, role })));
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
    return toPublic(
      this.editUser(email, (user) => ({
        ...user,
        tokenVersion: (user.tokenVersion ?? 0) + 1,
      })),
    );
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
