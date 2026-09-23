import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PluginLoggerLike } from "@yadsh/dsh-plugin-log";

/**
 * One schema step. Versions are dense and increasing; every step is applied
 * exactly once, in order, inside its own transaction.
 */
export interface SqliteMigration {
  readonly version: number;
  /** SQL for this step; may hold several statements. */
  readonly up: string;
}

/** How a store reports what it did to the database file. */
export interface SqliteDatabaseOptions {
  /**
   * The plugin's own logger, from `@yadsh/dsh-plugin-log`. Omitting it keeps
   * the store silent, which is what every store that predates this option did.
   * Passing an optional logger through is allowed: `undefined` means the same
   * as leaving the key out.
   */
  readonly logger?: PluginLoggerLike | undefined;
  /**
   * Prefix of the events this store writes (`<label>/db-opened`), so two
   * databases of one plugin stay tellable apart in one log. Defaults to the
   * file's stem.
   */
  readonly label?: string;
}

/** The bookkeeping table every QA database carries. */
const META_TABLE = "qa_meta";
const SCHEMA_VERSION_KEY = "schema_version";

/** A database this process cannot safely interpret. */
export class SqliteStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SqliteStoreError";
  }
}

/**
 * Shared SQLite plumbing for plugin stores that keep records plus append-only
 * audit logs.
 *
 * Such stores are tempting to keep as JSON documents, and the temptation is
 * what makes them expensive: every mutation reads, parses and rewrites the
 * whole history, so the cost of a write grows with everything ever written.
 * Opening the same data as tables makes a write touch only the rows it
 * changes, which is what removes the growth from the hot path.
 *
 * Two guarantees a temp-file-plus-rename ritual used to provide are kept
 * explicitly, because they are now the database's business:
 *
 * - **Atomicity** — `transaction` wraps a read-modify-write in one
 *   `BEGIN IMMEDIATE`, so a second process writing the same file (a plugin's
 *   CLI) cannot interleave into a state neither of them intended.
 * - **Durability of secrets** — the database file is chmod 0600 after creation,
 *   rather than whatever the process umask happens to say.
 *
 * WAL is enabled for that same second-process case: readers do not block the
 * writer and the writer does not block readers.
 *
 * What happens to the file is reported to the logger a store is given, because
 * a schema step that ran silently is a deployment fact nobody can recover
 * afterwards: an operator reading logs on a stand needs to see which database
 * was opened at which version, and which migrations that open applied.
 */
export class SqliteDatabase {
  private readonly connection: DatabaseSync;
  private readonly logger: PluginLoggerLike | undefined;
  private readonly label: string;
  private depth = 0;
  private closed = false;

  constructor(
    readonly filePath: string,
    migrations: readonly SqliteMigration[],
    options: SqliteDatabaseOptions = {},
  ) {
    this.logger = options.logger;
    this.label =
      options.label ?? path.basename(filePath, path.extname(filePath));
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
    const applied = this.migrate(migrations);
    this.logger?.info(`${this.label}/db-opened`, {
      file: filePath,
      schemaVersion: this.schemaVersion,
      appliedMigrations: applied,
    });
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

  private migrate(migrations: readonly SqliteMigration[]): readonly number[] {
    const ordered = [...migrations].sort(
      (left, right) => left.version - right.version,
    );
    const highest = ordered.at(-1)?.version ?? 0;
    const current = this.schemaVersion;
    if (current > highest) {
      this.logger?.error(`${this.label}/db-refused`, {
        file: this.filePath,
        schemaVersion: current,
        highestKnownVersion: highest,
      });
      throw new SqliteStoreError(
        `${this.filePath} was written by a newer schema (version ${current}, this build knows ${highest}); refusing to open it`,
      );
    }
    const applied: number[] = [];
    for (const migration of ordered) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.connection.exec(migration.up);
        this.setMeta(SCHEMA_VERSION_KEY, String(migration.version));
      });
      applied.push(migration.version);
    }
    // A brand-new file records its version even when no step had to run, so
    // "new" and "already at the current version" stay distinguishable.
    if (current === 0 && highest > 0) {
      this.transaction(() => this.setMeta(SCHEMA_VERSION_KEY, String(highest)));
    }
    this.restrictPermissions();
    return applied;
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
      throw new SqliteStoreError(`${this.filePath} is already closed`);
    }
  }
}
