import { randomBytes } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import {
  SqliteDatabase,
  type SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import type {
  QaEffectiveCapabilityPolicy,
  QaSkillActivationRecord,
  QaUserAccess,
} from "../types.js";
import {
  snapshotDigest,
  type AccountsFile,
  type StoredOwnership,
  type StoredProfile,
  type StoredStarters,
  type StoredUser,
} from "./file.js";

/** The token secret lives beside the schema version in the meta table. */
const SECRET_KEY = "token_secret";

/**
 * One step per released layout. Versions are dense: a database records the
 * highest one it has applied, and a build refuses to open a file from above it.
 */
const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE qa_accounts (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_login_at TEXT,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        profile_json TEXT,
        starters_json TEXT,
        qa_access_json TEXT
      );
      CREATE UNIQUE INDEX qa_accounts_email ON qa_accounts (email);

      -- Every admitted chat freezes the capabilities it was admitted with, and
      -- on a real deployment those policies are almost always the same list: 25
      -- snapshots on the live stand were two distinct ones, and restating them
      -- per chat was 45% of the file. One row per distinct policy, referenced.
      CREATE TABLE qa_snapshots (
        hash TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      );

      CREATE TABLE qa_ownership (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        subrole_id TEXT,
        admin_preview INTEGER NOT NULL DEFAULT 0,
        snapshot_hash TEXT REFERENCES qa_snapshots (hash)
      );
      CREATE INDEX qa_ownership_user ON qa_ownership (user_id, claimed_at DESC);

      CREATE TABLE qa_skill_activations (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `,
  },
  {
    version: 2,
    up: `
      -- One row per account that asked for a password reset from the sign-in
      -- screen. The row is what makes "забыли пароль?" a path rather than a
      -- dead end: an operator reads it and sets a new password. Keyed by
      -- account id, so a second tap updates the row instead of queueing a
      -- duplicate, and the count keeps the repetition visible.
      CREATE TABLE qa_password_resets (
        user_id TEXT PRIMARY KEY,
        requested_at TEXT NOT NULL,
        last_requested_at TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1
      );
      -- Integration tokens: the credentials a non-browser application
      -- presents to the QA HTTP API. The row keeps a digest of the secret and
      -- never the secret itself, so a copied database is not a copied
      -- credential; scopes, expiry and the revocation column are what make one
      -- token revocable without touching the account's browser sessions.
      CREATE TABLE qa_service_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX qa_service_tokens_user
        ON qa_service_tokens (user_id, created_at);
    `,
  },
];

interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: string;
  readonly disabled: number;
  readonly token_version: number;
  readonly created_at: string;
  readonly last_login_at: string | null;
  readonly password_salt: string;
  readonly password_hash: string;
  readonly profile_json: string | null;
  readonly starters_json: string | null;
  readonly qa_access_json: string | null;
}

interface PasswordResetRow {
  readonly user_id: string;
  readonly requested_at: string;
  readonly last_requested_at: string;
  readonly request_count: number;
}

interface OwnershipRow {
  readonly session_id: string;
  readonly user_id: string;
  readonly claimed_at: string;
  readonly subrole_id: string | null;
  readonly admin_preview: number;
  readonly snapshot_json: string | null;
}

interface ServiceTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly label: string;
  readonly token_hash: string;
  readonly scopes_json: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
  readonly use_count: number;
}

/**
 * One integration token as it is written. The digest is the only form of the
 * credential storage ever holds; the plaintext exists in the mint call and
 * nowhere else.
 */
export interface StoredServiceToken {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  /** SHA-256 of the token's secret, hex encoded. */
  readonly hash: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly useCount: number;
}

function toServiceToken(row: ServiceTokenRow): StoredServiceToken {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    hash: row.token_hash,
    scopes: JSON.parse(row.scopes_json) as readonly string[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    useCount: row.use_count,
  };
}

/** One ownership record as it is written, before it becomes a row. */
export interface OwnershipWrite {
  readonly sessionId: string;
  readonly owner: StoredOwnership;
}

/** SQLite hands back null-prototype records; the row shapes describe them. */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

function parseJsonColumn<T>(raw: string | null): T | undefined {
  if (raw === null || raw === "") return undefined;
  return JSON.parse(raw) as T;
}

function toUser(row: AccountRow): StoredUser {
  const profile = parseJsonColumn<StoredProfile>(row.profile_json);
  const starters = parseJsonColumn<StoredStarters>(row.starters_json);
  const qaAccess = parseJsonColumn<QaUserAccess>(row.qa_access_json);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as StoredUser["role"],
    passwordHash: { salt: row.password_salt, hash: row.password_hash },
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    ...(row.disabled === 1 ? { disabled: true } : {}),
    ...(row.token_version === 0 ? {} : { tokenVersion: row.token_version }),
    ...(profile === undefined ? {} : { profile }),
    ...(starters === undefined ? {} : { starters }),
    ...(qaAccess === undefined ? {} : { qaAccess }),
  };
}

/**
 * The deployment's accounts, as tables.
 *
 * The stores this replaces were one JSON document read, parsed and rewritten
 * whole on every mutation — so a chat being opened rewrote every account and
 * every chat the deployment had ever seen, and the cost of that write grew with
 * the deployment's age. Here a mutation touches the row it changes: opening a
 * chat inserts one ownership row, and the file's size stops being a per-turn
 * cost.
 *
 * Cross-process freshness survives the change. The `qa-accounts` CLI writes the
 * same database from a second process, so the in-memory model is invalidated by
 * `PRAGMA data_version`, which SQLite bumps exactly when *another* connection
 * commits — the same guarantee the previous mtime-and-size stamp provided, with
 * no file read to notice it.
 */
export class QaAccountsDatabase {
  readonly storage: SqliteDatabase;
  private observedDataVersion: number;

  constructor(readonly filePath: string) {
    this.storage = new SqliteDatabase(filePath, MIGRATIONS);
    this.observedDataVersion = this.readDataVersion();
    this.ensureSecret();
  }

  /** The token secret, creating one for a database that has none yet. */
  get secret(): string {
    const existing = this.storage.meta(SECRET_KEY);
    if (existing !== undefined && existing !== "") return existing;
    throw new Error(
      `qa-accounts: ${this.filePath} has no token secret; refusing to mint tokens`,
    );
  }

  /** True while the in-memory model a caller holds is still current. */
  get unchangedSinceLoad(): boolean {
    return this.readDataVersion() === this.observedDataVersion;
  }

  /** Take the current data version as the baseline a caller's model reflects. */
  markLoaded(): void {
    this.observedDataVersion = this.readDataVersion();
  }

  /** Every account, ownership record and skill activation, in one read. */
  loadAll(): AccountsFile {
    const users = asRows<AccountRow>(
      this.storage.db.prepare("SELECT * FROM qa_accounts ORDER BY seq").all(),
    );
    const ownershipRows = asRows<OwnershipRow>(
      this.storage.db
        .prepare(
          `SELECT o.session_id, o.user_id, o.claimed_at, o.subrole_id,
                  o.admin_preview, s.json AS snapshot_json
             FROM qa_ownership o
             LEFT JOIN qa_snapshots s ON s.hash = o.snapshot_hash`,
        )
        .all(),
    );
    const ownership: Record<string, StoredOwnership> = {};
    for (const row of ownershipRows) {
      const snapshot = parseJsonColumn<QaEffectiveCapabilityPolicy>(
        row.snapshot_json,
      );
      const skillActivations = asRows<{ json: string }>(
        this.storage.db
          .prepare(
            "SELECT json FROM qa_skill_activations WHERE session_id = ? ORDER BY seq",
          )
          .all(row.session_id),
      );
      ownership[row.session_id] = {
        userId: row.user_id,
        claimedAt: row.claimed_at,
        ...(row.subrole_id === null ? {} : { subroleId: row.subrole_id }),
        ...(row.admin_preview === 1 ? { adminPreview: true } : {}),
        ...(snapshot === undefined ? {} : { capabilitySnapshot: snapshot }),
        ...(skillActivations.length === 0
          ? {}
          : {
              skillActivations: skillActivations.map(
                (entry) => JSON.parse(entry.json) as QaSkillActivationRecord,
              ),
            }),
      };
    }
    this.markLoaded();
    return {
      version: 1,
      secret: this.secret,
      users: users.map(toUser),
      ownership,
    };
  }

  /** Append one account, preserving the order accounts are listed in. */
  insertUser(user: StoredUser): void {
    this.storage.transaction(() => {
      this.writeUser(user);
    });
  }

  /** Replace one account's row in place. */
  updateUser(user: StoredUser): void {
    this.storage.transaction(() => {
      this.writeUser(user, { replace: true });
    });
  }

  /**
   * Record one forgotten-password request. A repeat from the same account
   * moves the row up the queue and counts up, so the console shows "asked
   * again" rather than an identical-looking pile of rows.
   */
  recordPasswordReset(userId: string, at: string): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare(
          `INSERT INTO qa_password_resets
             (user_id, requested_at, last_requested_at, request_count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(user_id) DO UPDATE SET
             last_requested_at = excluded.last_requested_at,
             request_count = qa_password_resets.request_count + 1`,
        )
        .run(userId, at, at);
    });
  }

  /** Every pending request, newest first. */
  listPasswordResets(): readonly PasswordResetRow[] {
    return asRows<PasswordResetRow>(
      this.storage.db
        .prepare(
          `SELECT user_id, requested_at, last_requested_at, request_count
             FROM qa_password_resets
            ORDER BY last_requested_at DESC, user_id`,
        )
        .all(),
    );
  }

  /** Drop an account's pending request: it was answered, or it is moot. */
  clearPasswordReset(userId: string): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare("DELETE FROM qa_password_resets WHERE user_id = ?")
        .run(userId);
    });
  }

  /** Record a successful sign-in without rewriting the account. */
  touchLogin(userId: string, at: string): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare("UPDATE qa_accounts SET last_login_at = ? WHERE id = ?")
        .run(at, userId);
    });
  }

  /** Claim one chat for an account. */
  insertOwnership(sessionId: string, owner: StoredOwnership): void {
    this.storage.transaction(() => {
      this.writeOwnership(sessionId, owner);
    });
  }

  /** Claim many chats at once, which is how a browser's index migrates. */
  insertOwnershipMany(rows: readonly OwnershipWrite[]): void {
    if (rows.length === 0) return;
    this.storage.transaction(() => {
      for (const row of rows) this.writeOwnership(row.sessionId, row.owner);
    });
  }

  /** Rewrite an existing chat's pinned role, preview flag or snapshot. */
  updateOwnership(sessionId: string, owner: StoredOwnership): void {
    this.storage.transaction(() => {
      this.writeOwnership(sessionId, owner);
    });
  }

  /** Forget chats: a rolled-back reservation, or a chat the Harness lost. */
  deleteOwnership(sessionIds: readonly string[]): void {
    if (sessionIds.length === 0) return;
    this.storage.transaction(() => {
      const remove = this.storage.db.prepare(
        "DELETE FROM qa_ownership WHERE session_id = ?",
      );
      for (const sessionId of sessionIds) {
        remove.run(sessionId);
        this.storage.db
          .prepare("DELETE FROM qa_skill_activations WHERE session_id = ?")
          .run(sessionId);
      }
      this.gcSnapshots();
    });
  }

  /** Record one freshly minted integration token (digest only, never a secret). */
  insertServiceToken(token: StoredServiceToken): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare(
          `INSERT INTO qa_service_tokens
             (id, user_id, label, token_hash, scopes_json, created_at,
              expires_at, last_used_at, revoked_at, use_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          token.id,
          token.userId,
          token.label,
          token.hash,
          JSON.stringify(token.scopes),
          token.createdAt,
          token.expiresAt,
          token.lastUsedAt,
          token.revokedAt,
          token.useCount,
        );
    });
  }

  /**
   * One integration token by id, revoked and expired ones included.
   *
   * The caller needs the revoked ones: presenting a revoked token must be a
   * refusal, not a lookup miss, and the two are only distinguishable when the
   * row still answers.
   */
  serviceToken(tokenId: string): StoredServiceToken | undefined {
    const row = this.storage.db
      .prepare("SELECT * FROM qa_service_tokens WHERE id = ?")
      .get(tokenId) as ServiceTokenRow | undefined;
    return row === undefined ? undefined : toServiceToken(row);
  }

  /** Every integration token of one account, oldest first. */
  serviceTokensOf(userId: string): readonly StoredServiceToken[] {
    return asRows<ServiceTokenRow>(
      this.storage.db
        .prepare(
          "SELECT * FROM qa_service_tokens WHERE user_id = ? ORDER BY created_at, id",
        )
        .all(userId),
    ).map(toServiceToken);
  }

  /** Record that one token was used, without rewriting its row. */
  touchServiceToken(tokenId: string, at: string): void {
    this.storage.transaction(() => {
      this.storage.db
        .prepare(
          `UPDATE qa_service_tokens
              SET last_used_at = ?, use_count = use_count + 1
            WHERE id = ?`,
        )
        .run(at, tokenId);
    });
  }

  /** Revoke one token; already-revoked tokens keep their first timestamp. */
  revokeServiceToken(tokenId: string, at: string): boolean {
    return this.storage.transaction(() => {
      const result = this.storage.db
        .prepare(
          "UPDATE qa_service_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        )
        .run(at, tokenId);
      return result.changes > 0;
    });
  }

  /** Revoke every token of one account; returns how many were still live. */
  revokeServiceTokensOf(userId: string, at: string): number {
    return this.storage.transaction(() => {
      const result = this.storage.db
        .prepare(
          "UPDATE qa_service_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        )
        .run(at, userId);
      return Number(result.changes);
    });
  }

  /**
   * Append one skill activation and keep the newest `limit` of them. The list
   * is bounded because a long session may activate skills many times, and the
   * oldest entries stop being interesting long before the store does.
   */
  appendSkillActivation(
    sessionId: string,
    entry: QaSkillActivationRecord,
    limit: number,
  ): readonly QaSkillActivationRecord[] {
    return this.storage.transaction(() => {
      const next = this.storage.db
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM qa_skill_activations WHERE session_id = ?",
        )
        .get(sessionId) as { next: number };
      this.storage.db
        .prepare(
          "INSERT INTO qa_skill_activations (session_id, seq, json) VALUES (?, ?, ?)",
        )
        .run(sessionId, next.next, JSON.stringify(entry));
      if (limit > 0) {
        this.storage.db
          .prepare(
            `DELETE FROM qa_skill_activations
              WHERE session_id = ?
                AND seq <= ? - ?`,
          )
          .run(sessionId, next.next, limit);
      }
      const kept = asRows<{ json: string }>(
        this.storage.db
          .prepare(
            "SELECT json FROM qa_skill_activations WHERE session_id = ? ORDER BY seq",
          )
          .all(sessionId),
      );
      return kept.map((row) => JSON.parse(row.json) as QaSkillActivationRecord);
    });
  }

  /**
   * Import a pre-SQLite `qa-accounts.json` exactly once, then rename it away.
   *
   * The import is verified *inside* the transaction and before the file is
   * retired — every account and every ownership record must have arrived, and
   * the token secret must be the one the file carried — because a silent
   * partial import would either lock accounts out or hand a chat to the wrong
   * owner. A database that already holds accounts is never overwritten by a
   * leftover file.
   */
  importLegacyFile(
    legacyFilePath: string | undefined,
  ): AccountsFile | undefined {
    if (legacyFilePath === undefined) return undefined;
    let raw: string;
    try {
      raw = readFileSync(legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const legacy = this.parseLegacyFile(legacyFilePath, raw);
    if (this.hasAccounts()) return undefined;
    const imported = this.storage.transaction(() => {
      this.storage.setMeta(SECRET_KEY, legacy.secret);
      for (const user of legacy.users) this.writeUser(user);
      for (const [sessionId, owner] of Object.entries(legacy.ownership)) {
        this.writeOwnership(sessionId, owner);
      }
      const arrived = this.loadAll();
      this.assertImportArrived(legacyFilePath, legacy, arrived);
      return arrived;
    });
    renameSync(
      legacyFilePath,
      `${legacyFilePath}.migrated-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
    );
    return imported;
  }

  private assertImportArrived(
    legacyFilePath: string,
    legacy: AccountsFile,
    imported: AccountsFile,
  ): void {
    const problems: string[] = [];
    if (imported.secret !== legacy.secret) {
      problems.push("the token secret did not arrive");
    }
    if (imported.users.length !== legacy.users.length) {
      problems.push(
        `expected ${legacy.users.length} accounts, imported ${imported.users.length}`,
      );
    }
    const expectedSessions = Object.keys(legacy.ownership).length;
    const importedSessions = Object.keys(imported.ownership).length;
    if (importedSessions !== expectedSessions) {
      problems.push(
        `expected ${expectedSessions} chat records, imported ${importedSessions}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `qa-accounts: importing ${legacyFilePath} failed verification (${problems.join("; ")}); the file is left in place and the import was rolled back`,
      );
    }
  }

  close(): void {
    this.storage.close();
  }

  private hasAccounts(): boolean {
    const row = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM qa_accounts")
      .get() as { count: number };
    return row.count > 0;
  }

  private readDataVersion(): number {
    const row = this.storage.db.prepare("PRAGMA data_version").get() as {
      data_version: number;
    };
    return row.data_version;
  }

  private ensureSecret(): void {
    const existing = this.storage.meta(SECRET_KEY);
    if (existing !== undefined && existing !== "") return;
    this.storage.transaction(() => {
      // 32 random bytes, base64url — the shape the tokens already assume.
      this.storage.setMeta(SECRET_KEY, randomBytes(32).toString("base64url"));
    });
  }

  /** The account columns, in the order both write statements bind them. */
  private accountColumns(
    user: StoredUser,
  ): readonly (string | number | null)[] {
    return [
      user.email,
      user.displayName,
      user.role,
      user.disabled === true ? 1 : 0,
      user.tokenVersion ?? 0,
      user.createdAt,
      user.lastLoginAt,
      user.passwordHash.salt,
      user.passwordHash.hash,
      user.profile === undefined ? null : JSON.stringify(user.profile),
      user.starters === undefined ? null : JSON.stringify(user.starters),
      user.qaAccess === undefined ? null : JSON.stringify(user.qaAccess),
    ];
  }

  private writeUser(
    user: StoredUser,
    options: { replace?: boolean } = {},
  ): void {
    const columns = this.accountColumns(user);
    if (options.replace === true) {
      this.storage.db
        .prepare(
          `UPDATE qa_accounts
              SET email = ?, display_name = ?, role = ?, disabled = ?,
                  token_version = ?, created_at = ?, last_login_at = ?,
                  password_salt = ?, password_hash = ?, profile_json = ?,
                  starters_json = ?, qa_access_json = ?
            WHERE id = ?`,
        )
        .run(...columns, user.id);
      return;
    }
    // A new account lands after every account already stored, which is the
    // order the operator CLI and the console list them in.
    const next = this.storage.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM qa_accounts")
      .get() as { next: number };
    this.storage.db
      .prepare(
        `INSERT INTO qa_accounts
           (id, seq, email, display_name, role, disabled, token_version,
            created_at, last_login_at, password_salt, password_hash,
            profile_json, starters_json, qa_access_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, next.next, ...columns);
  }

  private writeOwnership(sessionId: string, owner: StoredOwnership): void {
    const snapshotHash =
      owner.capabilitySnapshot === undefined
        ? null
        : this.writeSnapshot(owner.capabilitySnapshot);
    this.storage.db
      .prepare(
        `INSERT INTO qa_ownership
           (session_id, user_id, claimed_at, subrole_id, admin_preview, snapshot_hash)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           user_id = excluded.user_id,
           claimed_at = excluded.claimed_at,
           subrole_id = excluded.subrole_id,
           admin_preview = excluded.admin_preview,
           snapshot_hash = excluded.snapshot_hash`,
      )
      .run(
        sessionId,
        owner.userId,
        owner.claimedAt,
        owner.subroleId ?? null,
        owner.adminPreview === true ? 1 : 0,
        snapshotHash,
      );
    const activations = owner.skillActivations ?? [];
    this.storage.db
      .prepare("DELETE FROM qa_skill_activations WHERE session_id = ?")
      .run(sessionId);
    const insert = this.storage.db.prepare(
      "INSERT INTO qa_skill_activations (session_id, seq, json) VALUES (?, ?, ?)",
    );
    activations.forEach((entry, index) => {
      insert.run(sessionId, index + 1, JSON.stringify(entry));
    });
    this.gcSnapshots();
  }

  /** One row per distinct policy; the digest is the policy's content. */
  private writeSnapshot(policy: QaEffectiveCapabilityPolicy): string {
    const hash = snapshotDigest(policy);
    this.storage.db
      .prepare(
        `INSERT INTO qa_snapshots (hash, json, first_seen_at) VALUES (?, ?, ?)
         ON CONFLICT(hash) DO NOTHING`,
      )
      .run(hash, JSON.stringify(policy), new Date().toISOString());
    return hash;
  }

  /** Drop snapshots no chat refers to any more, so the table cannot drift up. */
  private gcSnapshots(): void {
    this.storage.db
      .prepare(
        `DELETE FROM qa_snapshots
          WHERE hash NOT IN (
            SELECT snapshot_hash FROM qa_ownership
             WHERE snapshot_hash IS NOT NULL
          )`,
      )
      .run();
  }

  private parseLegacyFile(filePath: string, raw: string): AccountsFile {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as AccountsFile).version !== 1 ||
      typeof (parsed as AccountsFile).secret !== "string" ||
      !Array.isArray((parsed as AccountsFile).users)
    ) {
      throw new Error(
        `qa-accounts: ${filePath} is not a recognizable accounts file; refusing to import it`,
      );
    }
    const file = parsed as AccountsFile & {
      snapshots?: Record<string, QaEffectiveCapabilityPolicy>;
    };
    const snapshots = file.snapshots ?? {};
    const ownership: Record<string, StoredOwnership> = {};
    for (const [sessionId, entry] of Object.entries(file.ownership ?? {})) {
      const stored = entry as StoredOwnership & { snapshotRef?: string };
      const { snapshotRef, ...rest } = stored;
      if (snapshotRef === undefined) {
        ownership[sessionId] = rest;
        continue;
      }
      const snapshot = snapshots[snapshotRef];
      if (snapshot === undefined) {
        throw new Error(
          `qa-accounts: session ${sessionId} refers to missing capability snapshot ${snapshotRef}; refusing to import a corrupt accounts file`,
        );
      }
      ownership[sessionId] = { ...rest, capabilitySnapshot: snapshot };
    }
    return {
      version: 1,
      secret: file.secret,
      users: file.users,
      ownership,
    };
  }
}
