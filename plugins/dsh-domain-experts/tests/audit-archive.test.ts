import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionAuditArchive } from "../src/host/audit-archive.js";
import type { ExecutionAuditQuery, ExpertAuditEntry } from "../src/types.js";

const QUERY: ExecutionAuditQuery = {
  domainId: "payments",
  runId: 0,
  mode: "",
  status: "",
  execution: "",
  since: 0,
  beforeId: 0,
  limit: 100,
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

describe("execution audit archive", () => {
  let dir: string;
  let file: string;
  let now: number;
  const logger = { warn: vi.fn() };
  let archive: ExecutionAuditArchive | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dsh-expert-archive-"));
    file = join(dir, "runs.db");
    now = 1_800_000_000_000;
    logger.warn.mockClear();
  });
  afterEach(() => {
    archive?.close();
    archive = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  function open(enabled = true) {
    archive?.close();
    archive = new ExecutionAuditArchive(file, enabled, logger, () => now);
    return archive;
  }

  function entry(overrides: Partial<ExpertAuditEntry> = {}): ExpertAuditEntry {
    return {
      at: now,
      domainId: "payments",
      mode: "review",
      background: false,
      status: "error",
      durationMs: 275,
      callerDomain: "inventory",
      callerSessionId: "caller-fixture",
      childSessionId: "child-fixture",
      delegatePath: ["inventory", "payments"],
      degraded: ["MEMORY_PROVIDER_MISSING"],
      ...overrides,
    };
  }

  it("reopens and answers a failed-foreground-review query with stable pages and ID lookup", () => {
    const writer = open();
    writer.record(entry());
    writer.record(entry({ mode: "investigate" }));
    writer.record(entry({ domainId: "inventory" }));
    writer.record(entry({ status: "completed" }));
    writer.record(entry({ background: true, status: "delegated" }));
    now += 1;
    writer.record(entry({ durationMs: 431 }));
    const reader = open();
    const query: ExecutionAuditQuery = {
      ...QUERY,
      mode: "review",
      status: "error",
      execution: "foreground",
      since: now - WEEK_MS,
      limit: 1,
    };
    const first = reader.query(query);
    expect(first).toEqual({
      ok: true,
      code: "OK",
      message: "",
      entries: [
        {
          id: 6,
          at: now,
          domainId: "payments",
          mode: "review",
          background: false,
          status: "error",
          durationMs: 431,
        },
      ],
      nextBeforeId: 6,
    });
    reader.record(entry());
    const older = reader.query({ ...query, beforeId: first.nextBeforeId });
    expect(older.entries.map((row) => row.id)).toEqual([1]);
    expect(older.nextBeforeId).toBe(0);
    expect(reader.query({ ...QUERY, runId: 6 }).entries).toEqual(first.entries);
    expect(
      reader.query({ ...QUERY, domainId: "inventory", runId: 6 }).entries,
    ).toEqual([]);
    expect(reader.query({ ...QUERY, since: now + 1 }).entries).toEqual([]);
    expect(reader.query({ ...QUERY, limit: 101 }).code).toBe(
      "AUDIT_INVALID_QUERY",
    );
    expect(reader.query({ ...QUERY, limit: 0 }).code).toBe(
      "AUDIT_INVALID_QUERY",
    );
    expect(
      reader
        .query({ ...QUERY, execution: "background" })
        .entries.map((row) => row.id),
    ).toEqual([5]);
  });

  it("starts disabled, responds to a live toggle and purges expired rows when reopened disabled", () => {
    const disabled = open(false);
    disabled.record(entry());
    expect(disabled.query(QUERY).code).toBe("AUDIT_DISABLED");
    expect(existsSync(file)).toBe(false);

    disabled.setEnabled(true);
    disabled.record(entry());
    expect(disabled.query(QUERY).entries).toHaveLength(1);
    disabled.setEnabled(false);
    disabled.record(entry());
    disabled.setEnabled(true);
    expect(disabled.query(QUERY).entries.map((row) => row.id)).toEqual([1]);

    now += WEEK_MS + 1;
    expect(disabled.query(QUERY).entries).toEqual([]);
    const reopened = open(false);
    // Query filtering alone would hide the old row but leave its ID in storage.
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect(
        db.prepare("SELECT count(*) AS count FROM execution_audit").get(),
      ).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
    reopened.setEnabled(true);
    reopened.record(entry());
    expect(reopened.query(QUERY).entries.map((row) => row.id)).toEqual([2]);
  });

  it("enforces the row cap across all domains on insert", () => {
    const writer = open();
    const db = new DatabaseSync(file);
    try {
      db.prepare(
        `
        WITH RECURSIVE seed(i) AS (
          VALUES(1) UNION ALL SELECT i + 1 FROM seed WHERE i < 10000
        )
        INSERT INTO execution_audit (at, domain_id, mode, background, status, duration_ms)
        SELECT ?, 'inventory', 'answer', 0, 'completed', 275 FROM seed
      `,
      ).run(now);
      writer.record(entry());
      expect(
        db
          .prepare(
            "SELECT count(*) AS count, min(id) AS oldest FROM execution_audit",
          )
          .get(),
      ).toMatchObject({
        count: 10000,
        oldest: 2,
      });
      expect(writer.query(QUERY).entries.map((row) => row.id)).toEqual([10001]);
    } finally {
      db.close();
    }
  });

  it("reports a refused insert without discarding existing runs", () => {
    const writer = open();
    writer.record(entry());
    const db = new DatabaseSync(file);
    try {
      db.exec(`CREATE TRIGGER fail_write BEFORE INSERT ON execution_audit
               BEGIN SELECT RAISE(ABORT, 'fixture write failed'); END`);
      writer.record(entry({ durationMs: 800 }));
      expect(logger.warn).toHaveBeenCalledWith(
        "domain-expert/audit-write-failed",
      );
      expect(writer.query(QUERY).entries.map((row) => row.durationMs)).toEqual([
        275,
      ]);
      db.exec("DROP TRIGGER fail_write");
      writer.record(entry({ durationMs: 901 }));
      expect(writer.query(QUERY).entries.map((row) => row.durationMs)).toEqual([
        901, 275,
      ]);
    } finally {
      db.close();
    }
  });
});
