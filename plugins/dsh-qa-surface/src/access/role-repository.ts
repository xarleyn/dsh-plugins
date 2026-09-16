import { readFileSync, renameSync } from "node:fs";
import {
  SqliteDatabase,
  type SqliteMigration,
} from "@yadsh/dsh-plugin-kit/sqlite";
import type {
  QaAccessAuditAction,
  QaAccessAuditEvent,
  QaCapabilityConfig,
  QaCapabilitySelection,
  QaSkillAssignmentOverride,
  QaSubrole,
} from "../types.js";
import {
  defaultCapabilityConfig,
  normalizeCapabilityConfig,
  normalizeCapabilitySelection,
  normalizeSubrole,
} from "./model.js";
import { normalizeSkillOverride } from "./skill-metadata.js";

const MAX_AUDIT_EVENTS = 1_000;

const MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE role_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );

      -- One row per policy change. The trail is bounded by count and not by
      -- age: policies change rarely, and who granted what to whom is worth
      -- keeping exactly as long as the store it replaces did.
      CREATE TABLE role_audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        before TEXT,
        after TEXT
      );
    `,
  },
];

/** SQLite hands back null-prototype records; the row shapes describe them. */
function asRows<T>(value: unknown): T[] {
  return value as T[];
}

/**
 * One audit payload as text. Absent or unserializable values become NULL: the
 * trail records that there was nothing to compare, and SQLite has no
 * `undefined` to bind.
 */
function auditSnapshot(value: unknown): string | null {
  return JSON.stringify(value) ?? null;
}

function defaultBasePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return home !== undefined && home !== "" ? home : process.cwd();
}

export function defaultCapabilityFilePath(): string {
  return `${defaultBasePath()}/qa-capability-policies.db`;
}

/** The `.json` sibling of a `.db` path: what a deployment upgraded from. */
function legacySiblingOf(filePath: string): string | undefined {
  return filePath.endsWith(".db")
    ? `${filePath.slice(0, -".db".length)}.json`
    : undefined;
}

/** The pre-SQLite policy file, imported once on first use. */
export function defaultLegacyCapabilityFilePath(): string {
  return `${defaultBasePath()}/qa-capability-policies.json`;
}

interface RoleFile {
  readonly version: 1;
  readonly config: QaCapabilityConfig;
  readonly audit: readonly QaAccessAuditEvent[];
}

interface AuditRow {
  readonly timestamp: string;
  readonly actor_id: string;
  readonly action: string;
  readonly target_id: string | null;
  readonly before: string | null;
  readonly after: string | null;
}

/**
 * Atomic, externally reloadable source of truth for roles and their audit.
 *
 * The policy is one row and a change appends one row beside it, so an edit
 * writes what it changed instead of rewriting a growing document — the cost of
 * an administrative change no longer depends on how long the deployment has
 * been administering anything.
 *
 * Only the configuration is cached. An audit trail carries the full policy
 * that preceded each change, so reading it is reserved for the callers that
 * ask for it, and dropped whenever another process writes.
 */
export class QaRoleRepository {
  private readonly storage: SqliteDatabase;
  private config: QaCapabilityConfig;
  private auditCache: readonly QaAccessAuditEvent[] | undefined;
  private observedDataVersion: number;

  constructor(readonly filePath = defaultCapabilityFilePath()) {
    this.storage = new SqliteDatabase(filePath, MIGRATIONS);
    this.observedDataVersion = this.readDataVersion();
    try {
      // The pre-SQLite file sat beside the database, so it is looked for as
      // the `.json` sibling of the path this repository was given.
      this.importLegacyFile(
        legacySiblingOf(filePath) ?? defaultLegacyCapabilityFilePath(),
      );
      this.config = this.readConfig();
    } catch (error) {
      // A store that cannot start must not hold the database open: the caller
      // may retry, and a held handle blocks cleaning up after the failure.
      this.storage.close();
      throw error;
    }
  }

  close(): void {
    this.storage.close();
  }

  snapshot(): QaCapabilityConfig {
    this.refresh();
    return this.config;
  }

  audit(): readonly QaAccessAuditEvent[] {
    this.refresh();
    this.auditCache ??= this.readAudit();
    return this.auditCache;
  }

  create(actorId: string, input: QaSubrole): QaSubrole {
    const role = normalizeSubrole(input);
    const before = this.snapshot();
    if (before.subroles.some(({ id }) => id === role.id)) {
      throw new TypeError(`QA subrole "${role.id}" already exists`);
    }
    this.replace(
      actorId,
      "subrole.created",
      role.id,
      before,
      normalizeCapabilityConfig({
        ...before,
        subroles: [...before.subroles, role],
      }),
    );
    return role;
  }

  update(actorId: string, id: string, input: QaSubrole): QaSubrole {
    const role = normalizeSubrole(input);
    if (role.id !== id) throw new TypeError("subrole id is immutable");
    const before = this.snapshot();
    if (!before.subroles.some((candidate) => candidate.id === id)) {
      throw new TypeError(`QA subrole "${id}" does not exist`);
    }
    const after = normalizeCapabilityConfig({
      ...before,
      subroles: before.subroles.map((candidate) =>
        candidate.id === id ? role : candidate,
      ),
    });
    this.replace(actorId, "subrole.updated", id, before, after);
    return role;
  }

  delete(actorId: string, id: string): void {
    const before = this.snapshot();
    if (!before.subroles.some((candidate) => candidate.id === id)) {
      throw new TypeError(`QA subrole "${id}" does not exist`);
    }
    const after = normalizeCapabilityConfig({
      ...before,
      subroles: before.subroles.filter((candidate) => candidate.id !== id),
    });
    this.replace(actorId, "subrole.deleted", id, before, after);
  }

  updateCommon(
    actorId: string,
    input: QaCapabilitySelection,
  ): QaCapabilitySelection {
    const before = this.snapshot();
    const common = normalizeCapabilitySelection(input);
    const after = normalizeCapabilityConfig({ ...before, common });
    this.replace(actorId, "common.updated", undefined, before, after);
    return common;
  }

  /**
   * Replace one skill's administrator overlay.
   *
   * An overlay with nothing left to declare is removed outright, so clearing a
   * row in the administration surface leaves the store as if it was never set.
   * @param actorId - the administrator performing the change.
   * @param input - the overlay as edited in the browser.
   * @returns every overlay in force after the change.
   */
  updateSkillOverride(
    actorId: string,
    input: QaSkillAssignmentOverride,
  ): readonly QaSkillAssignmentOverride[] {
    const before = this.snapshot();
    const override = normalizeSkillOverride(input);
    const cleared =
      override.addToSubroles === undefined &&
      override.removeFromSubroles === undefined &&
      override.forceCommon !== true &&
      override.disabled !== true;
    const remaining = before.skillOverrides.filter(
      ({ skillName }) => skillName !== override.skillName,
    );
    const after = normalizeCapabilityConfig({
      ...before,
      skillOverrides: cleared ? remaining : [...remaining, override],
    });
    this.replace(
      actorId,
      "skill.assignment-updated",
      override.skillName,
      before,
      after,
    );
    return after.skillOverrides;
  }

  recordAssignment(
    actorId: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.refresh();
    this.storage.transaction(() => {
      this.appendAudit("assignment.updated", actorId, targetId, before, after);
    });
  }

  private replace(
    actorId: string,
    action: QaAccessAuditAction,
    targetId: string | undefined,
    before: QaCapabilityConfig,
    after: QaCapabilityConfig,
  ): void {
    this.storage.transaction(() => {
      this.writeConfig(after);
      this.appendAudit(action, actorId, targetId, before, after);
      this.config = after;
    });
  }

  /** Append one change and trim the trail to its newest events. */
  private appendAudit(
    action: QaAccessAuditAction,
    actorId: string,
    targetId: string | undefined,
    before: unknown,
    after: unknown,
  ): void {
    this.storage.db
      .prepare(
        `INSERT INTO role_audit
           (timestamp, actor_id, action, target_id, before, after)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        actorId,
        action,
        targetId ?? null,
        auditSnapshot(before),
        auditSnapshot(after),
      );
    this.storage.db
      .prepare(
        "DELETE FROM role_audit WHERE seq <= (SELECT MAX(seq) - ? FROM role_audit)",
      )
      .run(MAX_AUDIT_EVENTS);
    this.auditCache = undefined;
  }

  private writeConfig(config: QaCapabilityConfig): void {
    this.storage.db
      .prepare(
        `INSERT INTO role_config (id, json) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      )
      .run(JSON.stringify(config));
  }

  private readConfig(): QaCapabilityConfig {
    const row = this.storage.db
      .prepare("SELECT json FROM role_config WHERE id = 1")
      .get() as { json: string } | undefined;
    return row === undefined
      ? defaultCapabilityConfig()
      : normalizeCapabilityConfig(JSON.parse(row.json) as QaCapabilityConfig);
  }

  private readAudit(): readonly QaAccessAuditEvent[] {
    return Object.freeze(
      asRows<AuditRow>(
        this.storage.db.prepare("SELECT * FROM role_audit ORDER BY seq").all(),
      ).map((row) => ({
        timestamp: row.timestamp,
        actorId: row.actor_id,
        action: row.action as QaAccessAuditAction,
        ...(row.target_id === null ? {} : { targetId: row.target_id }),
        ...(row.before === null ? {} : { before: row.before }),
        ...(row.after === null ? {} : { after: row.after }),
      })),
    );
  }

  private readDataVersion(): number {
    const row = this.storage.db.prepare("PRAGMA data_version").get() as {
      data_version: number;
    };
    return row.data_version;
  }

  /**
   * Re-read the policy when another process wrote it. The `qa-admin` surfaces
   * and this store share one database, so a configuration an administrator
   * just saved must be the one the next policy resolution sees.
   */
  private refresh(): void {
    const version = this.readDataVersion();
    if (version === this.observedDataVersion) return;
    this.observedDataVersion = version;
    this.config = this.readConfig();
    this.auditCache = undefined;
  }

  /**
   * Import a pre-SQLite `qa-capability-policies.json` exactly once, then rename
   * it aside. A configuration the database already holds wins: a leftover file
   * must not silently revert an administrator's policy.
   */
  importLegacyFile(legacyFilePath: string): void {
    let raw: string;
    try {
      raw = readFileSync(legacyFilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as RoleFile).version !== 1 ||
      !Array.isArray((parsed as RoleFile).audit)
    ) {
      throw new Error(
        `qa-capability-policies: ${legacyFilePath} is not a recognizable policy file; refusing to import it`,
      );
    }
    const file = parsed as RoleFile;
    const existing = this.storage.db
      .prepare("SELECT json FROM role_config WHERE id = 1")
      .get() as { json: string } | undefined;
    if (existing !== undefined) return;
    this.storage.transaction(() => {
      this.writeConfig(normalizeCapabilityConfig(file.config));
      const insert = this.storage.db.prepare(
        `INSERT INTO role_audit
           (timestamp, actor_id, action, target_id, before, after)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const event of file.audit) {
        insert.run(
          event.timestamp,
          event.actorId,
          event.action,
          event.targetId ?? null,
          event.before === undefined ? null : String(event.before),
          event.after === undefined ? null : String(event.after),
        );
      }
      this.assertImportArrived(file.audit.length);
    });
    this.config = this.readConfig();
    this.auditCache = undefined;
    this.observedDataVersion = this.readDataVersion();
    renameSync(
      legacyFilePath,
      `${legacyFilePath}.migrated-${new Date().toISOString().replace(/[:.]/gu, "-")}`,
    );
  }

  private assertImportArrived(expectedAudit: number): void {
    const config = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM role_config")
      .get() as { count: number };
    const audit = this.storage.db
      .prepare("SELECT COUNT(*) AS count FROM role_audit")
      .get() as { count: number };
    const expectedEvents = Math.min(expectedAudit, MAX_AUDIT_EVENTS);
    const problems: string[] = [];
    if (config.count !== 1) problems.push("the policy did not arrive");
    if (audit.count !== expectedEvents) {
      problems.push(
        `expected ${expectedEvents} audit events, imported ${audit.count}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `qa-capability-policies: importing the pre-SQLite file failed verification (${problems.join("; ")}); the file is left in place and the import was rolled back`,
      );
    }
  }
}
