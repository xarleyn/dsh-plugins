import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  defaultCapabilityFilePath,
  defaultLegacyCapabilityFilePath,
  QaRoleRepository,
} from "../../src/access/role-repository.js";

const open: QaRoleRepository[] = [];

function openRepository(file: string): QaRoleRepository {
  const repository = new QaRoleRepository(file);
  open.push(repository);
  return repository;
}

/** Read the first column of a query out of the store's own database. */
function column<T>(file: string, sql: string): T[] {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare(sql).all() as Record<string, unknown>[]).map(
      (row) => Object.values(row)[0] as T,
    );
  } finally {
    db.close();
  }
}

function rig(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-roles-"));
  return { dir, file: path.join(dir, "qa-capability-policies.db") };
}

describe("QaRoleRepository storage", () => {
  it("defaults to the database beside the pre-SQLite file", () => {
    expect(
      defaultCapabilityFilePath().endsWith("qa-capability-policies.db"),
    ).toBe(true);
    expect(
      defaultLegacyCapabilityFilePath().endsWith("qa-capability-policies.json"),
    ).toBe(true);
  });

  it("persists the policy across instances and stores one config row", () => {
    const { file } = rig();
    const first = openRepository(file);
    const created = first.create("admin-1", {
      id: "reviewer",
      name: "Reviewer",
      description: "reads everything",
      enabled: true,
      capabilities: {
        tools: { always: ["read"], skillGrantable: [] },
        skills: [],
      },
    });
    first.close();

    expect(column<number>(file, "SELECT COUNT(*) FROM role_config")).toEqual([
      1,
    ]);
    const reopened = openRepository(file);
    // The default subrole plus the one this test created, in that order.
    expect(reopened.snapshot().subroles.map(({ id }) => id)).toEqual([
      "general",
      created.id,
    ]);
    expect(created.id).toBe("reviewer");
  });

  it("appends one audit row per change and bounds the trail by count", () => {
    const { file } = rig();
    const repository = openRepository(file);
    for (let index = 0; index < 5; index += 1) {
      repository.updateSkillOverride("admin-1", {
        skillName: `skill-${index}`,
        forceCommon: true,
      });
    }

    // One row per change, each carrying the policy it replaced.
    expect(column<string>(file, "SELECT action FROM role_audit")).toHaveLength(
      5,
    );
    expect(repository.audit()).toHaveLength(5);
    expect(repository.audit()[0]?.before).toBeDefined();

    // The trail is capped: the newest events survive, the oldest do not.
    const db = new DatabaseSync(file);
    db.exec("BEGIN");
    const insert = db.prepare(
      `INSERT INTO role_audit (timestamp, actor_id, action, target_id, before, after)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (let index = 0; index < 1_100; index += 1) {
      insert.run(
        new Date().toISOString(),
        "admin-1",
        "assignment.updated",
        `target-${index}`,
        "{}",
        "{}",
      );
    }
    db.exec("COMMIT");
    db.close();

    repository.recordAssignment("admin-1", "target-last", { a: 1 }, { a: 2 });

    expect(column<number>(file, "SELECT COUNT(*) FROM role_audit")).toEqual([
      1_000,
    ]);
    expect(
      column<string>(file, "SELECT target_id FROM role_audit"),
    ).not.toContain("target-0");
  });

  it("records a change whose operator sent no comparable value", () => {
    const { file } = rig();
    const repository = openRepository(file);

    // `undefined` has no SQLite binding and no JSON text: the row records that
    // there was nothing to compare rather than failing the change.
    expect(() =>
      repository.recordAssignment("admin-1", "target-1", undefined, undefined),
    ).not.toThrow();
    expect(repository.audit()).toHaveLength(1);
    expect(repository.audit()[0]?.before).toBeUndefined();
    expect(column<string>(file, "SELECT before FROM role_audit")).toEqual([
      null,
    ]);
  });
});

describe("QaRoleRepository import of the pre-SQLite file", () => {
  function writeLegacy(dir: string, config: unknown, audit: unknown[]): string {
    const file = path.join(dir, "qa-capability-policies.json");
    writeFileSync(
      file,
      `${JSON.stringify({ version: 1, config, audit }, null, 2)}\n`,
      "utf8",
    );
    return file;
  }

  const baseConfig = {
    version: 1,
    common: { tools: { always: ["read"], skillGrantable: [] }, skills: [] },
    subroles: [
      {
        id: "general",
        name: "General",
        description: "base profile",
        enabled: true,
        capabilities: {
          tools: { always: [], skillGrantable: [] },
          skills: [],
        },
      },
    ],
    skillOverrides: [],
  };

  it("imports the policy and its audit, then retires the file", () => {
    const { dir, file } = rig();
    const legacy = writeLegacy(dir, baseConfig, [
      {
        timestamp: "2026-09-15T00:00:00.000Z",
        actorId: "admin-1",
        action: "common.updated",
        before: "{}",
        after: "{}",
      },
    ]);

    const repository = openRepository(file);
    repository.importLegacyFile(legacy);

    expect(repository.snapshot().common.tools.always).toEqual(["read"]);
    expect(repository.audit()).toHaveLength(1);
    expect(repository.audit()[0]?.actorId).toBe("admin-1");
    expect(readdirSync(dir).some((name) => name.includes(".migrated-"))).toBe(
      true,
    );
    expect(() => readFileSync(legacy, "utf8")).toThrow();
  });

  it("refuses a file it cannot recognize and leaves it in place", () => {
    const { dir, file } = rig();
    // Built before the broken file exists, so this checks the import itself
    // rather than the sibling import the constructor performs.
    const repository = openRepository(file);
    const legacy = path.join(dir, "qa-capability-policies.json");
    writeFileSync(legacy, '{"version":2}\n', "utf8");

    expect(() => repository.importLegacyFile(legacy)).toThrow(
      /refusing to import/u,
    );
    expect(readFileSync(legacy, "utf8")).toBe('{"version":2}\n');
  });

  it("never lets a leftover file revert a stored policy", () => {
    const { dir, file } = rig();
    const repository = openRepository(file);
    repository.updateCommon("admin-1", {
      tools: { always: ["write"], skillGrantable: [] },
      skills: [],
    });
    const legacy = writeLegacy(dir, baseConfig, []);

    repository.importLegacyFile(legacy);

    expect(repository.snapshot().common.tools.always).toEqual(["write"]);
    // The leftover file stays where it is: dropping it is the operator's call.
    expect(readFileSync(legacy, "utf8")).toContain("read");
  });
});
