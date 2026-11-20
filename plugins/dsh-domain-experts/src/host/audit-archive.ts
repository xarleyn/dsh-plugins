import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { PluginLogger } from "@yadsh/dsh-plugin-log";
import {
  DOMAIN_ID_PATTERN,
  type ArchivedExpertRun,
  type ExecutionAuditQuery,
  type ExecutionAuditResult,
  type ExpertAuditEntry,
} from "../types.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1_000;
const OPEN_RETRY_MS = 30_000;

export function auditQueryRefused(
  code: string,
  message: string,
): ExecutionAuditResult {
  return { ok: false, code, message, entries: [], nextBeforeId: 0 };
}

/** Best-effort archive of only the metadata used by operator queries. */
export class ExecutionAuditArchive {
  private db: DatabaseSync | undefined;
  private enabled = false;
  private retryAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly file: string,
    enabled: boolean,
    private readonly logger: Pick<PluginLogger, "warn">,
    private readonly now = Date.now,
  ) {
    this.enabled = enabled;
    if (enabled || existsSync(file)) this.startMaintenance();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.retryAt = 0;
    this.startMaintenance();
  }

  record(entry: ExpertAuditEntry): void {
    if (!this.enabled) return;
    try {
      const db = this.open();
      if (db === undefined) return;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO execution_audit
             (at, domain_id, mode, background, status, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          entry.at,
          entry.domainId,
          entry.mode,
          Number(entry.background),
          entry.status,
          Math.max(0, entry.durationMs),
        );
        this.prune(db);
        db.exec("COMMIT");
      } catch (error) {
        // SQLite can already have rolled back on an I/O failure.
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    } catch {
      this.logger.warn("domain-expert/audit-write-failed");
    }
  }

  query(query: ExecutionAuditQuery): ExecutionAuditResult {
    if (!this.enabled) {
      return auditQueryRefused(
        "AUDIT_DISABLED",
        "Execution audit is disabled in the Domain Experts Host settings.",
      );
    }
    if (
      !DOMAIN_ID_PATTERN.test(query.domainId) ||
      ![query.runId, query.since, query.beforeId, query.limit].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      return auditQueryRefused("AUDIT_INVALID_QUERY", "Invalid audit query.");
    }
    try {
      const db = this.open();
      if (db !== undefined) return this.read(db, query);
    } catch {
      this.logger.warn("domain-expert/audit-read-failed");
    }
    return auditQueryRefused(
      "AUDIT_UNAVAILABLE",
      "Execution audit is unavailable.",
    );
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.enabled = false;
    try {
      this.db?.close();
    } catch {
      this.logger.warn("domain-expert/audit-close-failed");
    }
    this.db = undefined;
  }

  private startMaintenance(): void {
    this.sweep();
    this.timer ??= setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
  }

  private open(): DatabaseSync | undefined {
    if (this.db !== undefined) return this.db;
    if (this.now() < this.retryAt) return undefined;
    // An existing archive still expires while opted out. A fresh disabled
    // profile needs neither a directory nor a database.
    if (!this.enabled && !existsSync(this.file)) return undefined;

    let db: DatabaseSync | undefined;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      closeSync(openSync(this.file, "a", 0o600));
      db = new DatabaseSync(this.file);
      db.exec(`
        PRAGMA busy_timeout = 50;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS execution_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          domain_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          background INTEGER NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS execution_audit_domain ON execution_audit(domain_id, id);
        CREATE INDEX IF NOT EXISTS execution_audit_at ON execution_audit(at);
      `);
      this.prune(db);
      this.db = db;
      return db;
    } catch {
      db?.close();
      this.retryAt = this.now() + OPEN_RETRY_MS;
      this.logger.warn("domain-expert/audit-open-failed");
      return undefined;
    }
  }

  private sweep(): void {
    try {
      if (this.db === undefined) this.open();
      else this.prune(this.db);
    } catch {
      this.logger.warn("domain-expert/audit-retention-failed");
    }
  }

  private prune(db: DatabaseSync): void {
    db.prepare(
      `DELETE FROM execution_audit WHERE at < ?
       OR id <= (SELECT id FROM execution_audit ORDER BY id DESC LIMIT 1 OFFSET ?)`,
    ).run(this.now() - RETENTION_MS, MAX_ENTRIES);
  }

  private read(
    db: DatabaseSync,
    query: ExecutionAuditQuery,
  ): ExecutionAuditResult {
    const conditions = ["domain_id = ?", "at >= ?"];
    const values: SQLInputValue[] = [
      query.domainId,
      Math.max(query.since, this.now() - RETENTION_MS),
    ];
    if (query.runId > 0) {
      conditions.push("id = ?");
      values.push(query.runId);
    }
    if (query.beforeId > 0) {
      conditions.push("id < ?");
      values.push(query.beforeId);
    }
    if (query.mode !== "") {
      conditions.push("mode = ?");
      values.push(query.mode);
    }
    if (query.status !== "") {
      conditions.push("status = ?");
      values.push(query.status);
    }
    if (query.execution !== "") {
      conditions.push("background = ?");
      values.push(Number(query.execution === "background"));
    }
    const rows = db
      .prepare(
        `SELECT id, at, domain_id AS domainId, mode, background, status,
              duration_ms AS durationMs
       FROM execution_audit WHERE ${conditions.join(" AND ")}
       ORDER BY id DESC LIMIT ?`,
      )
      .all(...values, query.limit + 1) as unknown as (Omit<
      ArchivedExpertRun,
      "background"
    > & { background: number })[];
    const entries = rows.slice(0, query.limit).map((row) => ({
      ...row,
      background: row.background === 1,
    }));
    return {
      ok: true,
      code: "OK",
      message: "",
      entries,
      nextBeforeId: rows.length > query.limit ? entries.at(-1)!.id : 0,
    };
  }
}
