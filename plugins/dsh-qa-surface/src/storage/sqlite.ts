import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * One schema step. Versions are dense and increasing; every step is applied
 * exactly once, in order, inside its own transaction.
 */
export interface QaSqliteMigration {
  readonly version: number;
  /** SQL for this step; may hold several statements. */
  readonly up: string;
}

/** The bookkeeping table every QA database carries. */
const META_TABLE = "qa_meta";
const SCHEMA_VERSION_KEY = "schema_version";

/** A database this process cannot safely interpret. */
export class QaSqliteStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QaSqliteStoreError";
  }
}

/**
 * The shared SQLite plumbing behind the QA surface's keyed stores.
 *
 * Those stores are records plus append-only audit logs, and they were JSON
 * documents: every mutation read, parsed and rewrote the whole history, so the
 * cost of a write grew with everything ever written. Opening the same data as
 * tables makes a write touch only the rows it changes, which is what removes
 * the growth from the hot path.
 *
 * Two guarantees the previous temp-file-plus-rename ritual provided are kept
 * explicitly, because they are now the database's business:
 *
 * - **Atomicity** — `transaction` wraps a read-modify-write in one
 *   `BEGIN IMMEDIATE`, so a CLI write and a Host write cannot interleave into
 *   a state neither of them intended (replacing the mtime stamp dance).
 * - **Durability of secrets** — the database file is chmod 0600 after creation.
 *
 * WAL is enabled so the `qa-accounts` CLI can work against the same file from
 * a second process while the Host serves it.
 */
export class QaSqliteDatabase {
  private readonly connection: DatabaseSync;
  private depth = 0;
  private closed = false;

  constructor(
    readonly filePath: string,
    migrations: readonly QaSqliteMigration[],
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.connection = new DatabaseSync(filePath);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA synchronous = NORMAL");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.restrictPermissions();
    this.connection.exec(
      `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    this.migrate(migrations);
  }

  /** The live connection, for stores that prepare their own statements. */
  get db(): DatabaseSync {
    this.assertOpen();
    return this.connection;
  }

  get schemaVersion(): number {
    return Number(this.meta(SCHEMA_VERSION_KEY) ?? 0);
  }

  meta(key: string): string | undefined {
    this.assertOpen();
    const row = this.connection
      .prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.assertOpen();
    this.connection
      .prepare(
        `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /**
   * Run `work` inside one write transaction. A nested call joins the
   * transaction already in flight rather than opening a second one, so a
   * store's methods compose without every caller knowing whether it is
   * already inside a write.
   */
  transaction<T>(work: () => T): T {
    this.assertOpen();
    if (this.depth > 0) return work();
    this.connection.exec("BEGIN IMMEDIATE");
    this.depth += 1;
    try {
      const result = work();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.connection.exec("ROLLBACK");
      } catch {
        // A failed rollback means the transaction is already gone; the
        // original failure is the one worth reporting.
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
  }

  private migrate(migrations: readonly QaSqliteMigration[]): void {
    const ordered = [...migrations].sort(
      (left, right) => left.version - right.version,
    );
    const highest = ordered.at(-1)?.version ?? 0;
    const current = this.schemaVersion;
    if (current > highest) {
      throw new QaSqliteStoreError(
        `${this.filePath} was written by a newer schema (version ${current}, this build knows ${highest}); refusing to open it`,
      );
    }
    for (const migration of ordered) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.connection.exec(migration.up);
        this.setMeta(SCHEMA_VERSION_KEY, String(migration.version));
      });
    }
    // A brand-new file records its version even when no step had to run, so
    // "new" and "already at the current version" stay distinguishable.
    if (current === 0 && highest > 0) {
      this.transaction(() => this.setMeta(SCHEMA_VERSION_KEY, String(highest)));
    }
    this.restrictPermissions();
  }

  /**
   * Credential material lives in these files. SQLite creates them with the
   * process umask, which is not a policy; this is.
   */
  private restrictPermissions(): void {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        chmodSync(`${this.filePath}${suffix}`, 0o600);
      } catch {
        // Windows ignores POSIX modes, and a sidecar appears only once the
        // first write lands: neither is a reason to refuse the store.
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new QaSqliteStoreError(`${this.filePath} is already closed`);
    }
  }
}

/** Rows come back as null-prototype objects; stores spread them into shapes. */
export function rowToObject<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}
