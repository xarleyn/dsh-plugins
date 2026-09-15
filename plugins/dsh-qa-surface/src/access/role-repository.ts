import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  QaAccessAuditAction,
  QaAccessAuditEvent,
  QaCapabilityConfig,
  QaCapabilitySelection,
  QaSubrole,
} from "../types.js";
import {
  defaultCapabilityConfig,
  normalizeCapabilityConfig,
  normalizeCapabilitySelection,
  normalizeSubrole,
} from "./model.js";

interface RoleFile {
  readonly version: 1;
  readonly config: QaCapabilityConfig;
  readonly audit: readonly QaAccessAuditEvent[];
}

interface Stamp {
  readonly mtimeMs: number;
  readonly size: number;
}

const MAX_AUDIT_EVENTS = 1_000;

function auditSnapshot(value: unknown): string {
  return JSON.stringify(value);
}

export function defaultCapabilityFilePath(): string {
  const home = process.env.DSH_HOME?.trim();
  return path.join(
    home !== undefined && home !== "" ? home : process.cwd(),
    "qa-capability-policies.json",
  );
}

function stamp(filePath: string): Stamp {
  const stat = statSync(filePath);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

function same(left: Stamp | undefined, right: Stamp): boolean {
  return left?.mtimeMs === right.mtimeMs && left.size === right.size;
}

function initialFile(): RoleFile {
  return { version: 1, config: defaultCapabilityConfig(), audit: [] };
}

/** Atomic, externally reloadable source of truth for roles and their audit. */
export class QaRoleRepository {
  private file: RoleFile;
  private fileStamp: Stamp | undefined;

  constructor(readonly filePath = defaultCapabilityFilePath()) {
    this.file = this.load();
  }

  snapshot(): QaCapabilityConfig {
    this.reload();
    return this.file.config;
  }

  audit(): readonly QaAccessAuditEvent[] {
    this.reload();
    return this.file.audit;
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

  recordAssignment(
    actorId: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.reload();
    this.persist({
      ...this.file,
      audit: this.appendAudit(
        "assignment.updated",
        actorId,
        targetId,
        before,
        after,
      ),
    });
  }

  private replace(
    actorId: string,
    action: QaAccessAuditAction,
    targetId: string | undefined,
    before: QaCapabilityConfig,
    after: QaCapabilityConfig,
  ): void {
    this.persist({
      version: 1,
      config: after,
      audit: this.appendAudit(action, actorId, targetId, before, after),
    });
  }

  private appendAudit(
    action: QaAccessAuditAction,
    actorId: string,
    targetId: string | undefined,
    before: unknown,
    after: unknown,
  ): readonly QaAccessAuditEvent[] {
    return [
      ...this.file.audit,
      {
        timestamp: new Date().toISOString(),
        actorId,
        action,
        ...(targetId === undefined ? {} : { targetId }),
        before: auditSnapshot(before),
        after: auditSnapshot(after),
      },
    ].slice(-MAX_AUDIT_EVENTS);
  }

  private reload(): void {
    let current: Stamp;
    try {
      current = stamp(this.filePath);
    } catch {
      return;
    }
    if (same(this.fileStamp, current)) return;
    this.file = this.load();
  }

  private load(): RoleFile {
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, "utf8"),
      ) as RoleFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.audit)) {
        throw new TypeError("unrecognized QA capability policy file");
      }
      this.fileStamp = stamp(this.filePath);
      return {
        version: 1,
        config: normalizeCapabilityConfig(parsed.config),
        audit: Object.freeze(
          parsed.audit.map((event) => ({
            ...event,
            ...(event.before === undefined
              ? {}
              : {
                  before:
                    typeof event.before === "string"
                      ? event.before
                      : auditSnapshot(event.before),
                }),
            ...(event.after === undefined
              ? {}
              : {
                  after:
                    typeof event.after === "string"
                      ? event.after
                      : auditSnapshot(event.after),
                }),
          })),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const created = initialFile();
      this.persist(created);
      return created;
    }
  }

  private persist(file: RoleFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
    this.file = file;
    this.fileStamp = stamp(this.filePath);
  }
}
