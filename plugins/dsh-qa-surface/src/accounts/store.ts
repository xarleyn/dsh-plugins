import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  QaAccountRole,
  QaAccountSession,
  QaAccountUserPublic,
  QaClaimResult,
  QaWhoamiResult,
} from "../types.js";

/**
 * Coarse, wire-safe account failure codes. They ride the `(reason: <code>)`
 * marker pattern the attestation path established; the browser maps them to
 * audience-safe copy and the precise cause stays in the Host logs.
 */
export type QaAccountsErrorReason =
  | "auth-required"
  | "invalid-credentials"
  | "email-taken"
  | "invalid-email"
  | "invalid-display-name"
  | "weak-password"
  | "registration-disabled"
  | "rate-limited"
  | "session-owned-elsewhere";

export class QaAccountsError extends Error {
  constructor(
    readonly reason: QaAccountsErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "QaAccountsError";
  }
}

interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: QaAccountRole;
  /** scrypt material: hex salt + hex hash. */
  readonly passwordHash: { readonly salt: string; readonly hash: string };
  readonly createdAt: string;
  lastLoginAt: string | null;
}

interface AccountsFile {
  readonly version: 1;
  /** HMAC key for account tokens; rotated on password change by rewriting it. */
  readonly secret: string;
  readonly users: StoredUser[];
  readonly ownership: Record<
    string,
    { readonly userId: string; readonly claimedAt: string }
  >;
}

export interface QaAccountsOptions {
  readonly sessionTtlDays: number;
  readonly allowRegistration: boolean;
  /** Login/registration attempts accepted per rolling minute, store-wide. */
  readonly maxAuthAttemptsPerMinute?: number;
}

const SCRYPT_KEY_LENGTH = 32;
const SECRET_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_CLAIM_BATCH = 50;
const MAX_SESSION_ID_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** The accounts file lives next to the DSH home the launcher exports. */
export function defaultAccountsFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-accounts.json",
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

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Host authority for QA accounts: the file-backed user list, the session
 * ownership map and the HMAC account tokens. All mutations are synchronous
 * and persisted atomically (temp file + rename); LAN scale keeps this trivial.
 */
export class QaAccounts {
  private file: AccountsFile;
  private readonly authAttempts: number[] = [];
  private readonly maxAuthAttemptsPerMinute: number;
  private readonly sessionTtlDays: number;
  private readonly allowRegistration: boolean;

  constructor(
    readonly filePath: string = defaultAccountsFilePath(),
    options: QaAccountsOptions,
  ) {
    this.sessionTtlDays = options.sessionTtlDays;
    this.allowRegistration = options.allowRegistration;
    this.maxAuthAttemptsPerMinute = options.maxAuthAttemptsPerMinute ?? 30;
    this.file = this.load();
  }

  private load(): AccountsFile {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      const created: AccountsFile = {
        version: 1,
        secret: base64Url(randomBytes(SECRET_BYTES)),
        users: [],
        ownership: {},
      };
      this.persist(created);
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
        `qa-accounts: ${this.filePath} is not a recognizable accounts file; refusing to overwrite it`,
      );
    }
    const file = parsed as AccountsFile;
    return {
      version: 1,
      secret: file.secret,
      users: file.users,
      ownership: file.ownership ?? {},
    };
  }

  private persist(file: AccountsFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    renameSync(temp, this.filePath);
  }

  private save(): void {
    this.persist(this.file);
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
    this.assertAuthBudget();
    if (!this.allowRegistration) {
      throw new QaAccountsError(
        "registration-disabled",
        "self-registration is disabled on this deployment",
      );
    }
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
      throw new QaAccountsError(
        "invalid-email",
        "email is not a usable address",
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      throw new QaAccountsError(
        "weak-password",
        `password must be ${MIN_PASSWORD_LENGTH} to 200 characters`,
      );
    }
    const name = (displayName ?? "").trim();
    if (name.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new QaAccountsError(
        "invalid-display-name",
        `display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
      );
    }
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
    };
    this.file = { ...this.file, users: [...this.file.users, user] };
    this.save();
    return { token: this.mintToken(user.id), user: toPublic(user) };
  }

  login(email: string, password: string): QaAccountSession {
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
    user.lastLoginAt = new Date().toISOString();
    this.save();
    return { token: this.mintToken(user.id), user: toPublic(user) };
  }

  whoami(token: string): QaWhoamiResult {
    const userId = this.verifyToken(token);
    if (userId === null) return { authenticated: false };
    const user = this.file.users.find((candidate) => candidate.id === userId);
    return user === undefined
      ? { authenticated: false }
      : { authenticated: true, user: toPublic(user) };
  }

  /** Resolve a token to its user, or null for absent/invalid/expired ones. */
  verifyToken(token: string): string | null {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const payload = parts[1];
    const signature = parts[2];
    if (payload === undefined || signature === undefined) return null;
    let expected: Buffer;
    let decoded: { uid?: unknown; exp?: unknown };
    try {
      expected = createHmac("sha256", this.file.secret)
        .update(payload)
        .digest();
      const expectedSignature = base64Url(expected);
      if (
        signature.length !== expectedSignature.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
      ) {
        return null;
      }
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (
      typeof decoded.uid !== "string" ||
      typeof decoded.exp !== "number" ||
      decoded.exp < Date.now()
    ) {
      return null;
    }
    return decoded.uid;
  }

  private mintToken(userId: string): string {
    const payload = base64Url(
      JSON.stringify({
        uid: userId,
        exp: Date.now() + this.sessionTtlDays * 86_400_000,
      }),
    );
    const signature = base64Url(
      createHmac("sha256", this.file.secret).update(payload).digest(),
    );
    return `v1.${payload}.${signature}`;
  }

  /** The account behind a token, or an auth-required refusal. */
  requireUser(token: string): StoredUser {
    const userId = this.verifyToken(token);
    const user =
      userId === null
        ? undefined
        : this.file.users.find((candidate) => candidate.id === userId);
    if (user === undefined) {
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
      return user;
    }
    if (owner.userId !== user.id && user.role !== "admin") {
      throw new QaAccountsError(
        "session-owned-elsewhere",
        "this session belongs to another QA user",
      );
    }
    return user;
  }

  /** Bulk-claim a browser's local chat index; foreign ids come back as conflicts. */
  claimSessions(token: string, sessionIds: readonly string[]): QaClaimResult {
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
    const user = this.requireUser(token);
    return Object.entries(this.file.ownership)
      .filter(([, owner]) => owner.userId === user.id)
      .sort((left, right) =>
        right[1].claimedAt.localeCompare(left[1].claimedAt),
      )
      .map(([sessionId]) => sessionId);
  }
}
