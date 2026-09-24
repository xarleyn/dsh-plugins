import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createSqliteMemoryProvider,
  type SqliteMemoryProvider,
} from "../src/host/memory/sqlite.js";
import type { MemoryRecord } from "../src/types.js";
import { fixedClock, memoryTable } from "./helpers/fakes.js";
import {
  fixtureMemoryTable,
  productionShapedRecords,
} from "./helpers/memory-fixture.js";

/**
 * The gate the migration is judged by: memory that was already written is
 * still there afterwards, record for record.
 *
 * A counter alone would pass on a copy that lost a tag, turned a timestamp into
 * a string or shortened a text — the row is there, its content is not what was
 * stored. So the checks below compare fields, and they also check the other
 * half of the promise: the storage unit still holds everything when the import
 * is done, because that copy is how a deployment goes back.
 */

const directories: string[] = [];
const open: SqliteMemoryProvider[] = [];

function provider(
  options: Partial<Parameters<typeof createSqliteMemoryProvider>[0]> = {},
): SqliteMemoryProvider {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-memory-import-"));
  directories.push(dir);
  const created = createSqliteMemoryProvider({
    filePath: path.join(dir, "domain-experts-memory.db"),
    now: fixedClock(1_758_000_000_000, 0),
    ...options,
  });
  open.push(created);
  return created;
}

afterAll(() => {
  for (const provider of open) provider.close();
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function snapshotOf(
  table: ReturnType<typeof fixtureMemoryTable>,
): [string, MemoryRecord][] {
  return [...table.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  );
}

describe("memory import: nothing is lost", () => {
  it("copies every record and reports what arrived", () => {
    const records = productionShapedRecords();
    const sqlite = provider();
    const report = sqlite.importFromUnit(fixtureMemoryTable(records));

    expect(report).toEqual({
      outcome: "imported",
      records: records.length,
      namespaces: 3,
    });
    expect(records).toHaveLength(30);
  });

  it("copies each field, not just each row", async () => {
    const records = productionShapedRecords();
    const sqlite = provider();
    sqlite.importFromUnit(fixtureMemoryTable(records));

    const byId = new Map(
      records.map((record) => [`${record.namespace}/${record.key}`, record]),
    );
    const imported = await sqlite.inspect("domain/answer-reviewer");
    expect(imported).toHaveLength(27);
    for (const row of imported) {
      const source = byId.get(`${row.namespace}/${row.key}`);
      expect(source, `missing source for ${row.key}`).toBeDefined();
      expect(row.text).toBe(source?.text);
      expect(row.tags).toEqual(source?.tags);
      expect(row.createdAt).toBe(source?.createdAt);
      expect(row.updatedAt).toBe(source?.updatedAt);
      expect(row.key).toBe(source?.key);
      expect(row.namespace).toBe(source?.namespace);
    }
    // The record that arrived at the write-time cap is not shortened again.
    const truncated = imported.find(
      (row) => row.key === "review-long-answer-truncated",
    );
    expect(truncated?.text).toHaveLength(8_001);
  });

  it("leaves the storage unit holding every record", () => {
    const records = productionShapedRecords();
    const table = fixtureMemoryTable(records);
    const before = snapshotOf(table);
    const sqlite = provider();
    sqlite.importFromUnit(table);

    expect(snapshotOf(table)).toEqual(before);
  });

  it("imports once, and later records of the unit are not folded in", async () => {
    const records = productionShapedRecords();
    const table = fixtureMemoryTable(records);
    const sqlite = provider();
    expect(sqlite.importFromUnit(table).outcome).toBe("imported");
    expect(sqlite.importFromUnit(table).outcome).toBe("already-imported");

    const late: MemoryRecord = {
      namespace: "domain/platform",
      key: "written-after-the-import",
      text: "Запись, появившаяся в юните после импорта.",
      tags: ["review"],
      createdAt: 1,
      updatedAt: 2,
    };
    await table.put("domain/platform::written-after-the-import", late);
    expect(sqlite.importFromUnit(table).outcome).toBe("already-imported");
    expect(await sqlite.inspect("domain/platform")).toHaveLength(1);
  });

  it("imports a unit that was still empty when the plugin first opened it", async () => {
    const table = fixtureMemoryTable([]);
    const sqlite = provider();
    expect(sqlite.importFromUnit(table).outcome).toBe("nothing-to-import");

    const seeded: MemoryRecord = {
      namespace: "domain/answer-reviewer",
      key: "seeded-by-the-kit",
      text: "Память, записанная после открытия пустого юнита.",
      tags: ["review", "seed"],
      createdAt: 10,
      updatedAt: 20,
    };
    await table.put("domain/answer-reviewer::seeded-by-the-kit", seeded);
    expect(sqlite.importFromUnit(table)).toEqual({
      outcome: "imported",
      records: 1,
      namespaces: 1,
    });
    expect(await sqlite.inspect("domain/answer-reviewer")).toEqual([seeded]);
  });
});

describe("memory import: it refuses rather than guesses", () => {
  it("keeps the records the database already has", async () => {
    const records = productionShapedRecords();
    const sqlite = provider();
    const kept = await sqlite.remember(
      "domain/payments",
      "cutoff",
      "Вердикт, записанный после переезда.",
      ["review"],
    );

    expect(sqlite.importFromUnit(fixtureMemoryTable(records)).outcome).toBe(
      "kept-existing",
    );
    const remaining = await sqlite.inspect("domain/payments");
    expect(remaining.find((row) => row.key === "cutoff")?.text).toBe(kept.text);
    // One row from the provider's own write, not the fixture's payments notes.
    expect(remaining).toHaveLength(1);
  });

  it("refuses a unit whose record cannot be copied faithfully", () => {
    // A hand-edited unit: a timestamp stored as a string. SQLite takes the
    // number, converting on the way in, so the row count and the row's presence
    // both look fine — and the record a reader sorts by is no longer the record
    // that was written. Comparing fields, not counters, is what catches it.
    const table = memoryTable<MemoryRecord>([
      [
        "domain/payments::cutoff",
        {
          namespace: "domain/payments",
          key: "cutoff",
          text: "note",
          tags: ["review"],
          createdAt: "1758000000000" as unknown as number,
          updatedAt: 2,
        },
      ],
    ]);
    const before = snapshotOf(table);
    const sqlite = provider();

    expect(() => sqlite.importFromUnit(table)).toThrow(
      /failed verification[\s\S]*new createdAt/u,
    );
    // Nothing arrived, the unit still holds the record, and no marker was
    // written: the next start refuses for the same reason rather than serving
    // an expert from a database that half-copied.
    expect(sqlite.listNamespaces()).toEqual([]);
    expect(snapshotOf(table)).toEqual(before);
    expect(() => sqlite.importFromUnit(table)).toThrow(/failed verification/u);
    expect(sqlite.listNamespaces()).toEqual([]);
  });

  it("refuses a unit that holds two records with one identity", () => {
    // The storage key is a flat `namespace::key`, so a unit can carry two
    // entries whose record fields name the same row. The copy cannot hold both,
    // and importing one while dropping the other is the loss this gate refuses.
    const table = memoryTable<MemoryRecord>([
      [
        "domain/payments::cutoff",
        {
          namespace: "domain/payments",
          key: "cutoff",
          text: "первая",
          tags: ["review"],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      [
        "domain/payments::cutoff-via-another-key",
        {
          namespace: "domain/payments",
          key: "cutoff",
          text: "вторая",
          tags: ["review"],
          createdAt: 3,
          updatedAt: 4,
        },
      ],
    ]);
    const sqlite = provider();

    // The refusal names the row the database could not hold, which is what an
    // operator needs to find in the unit.
    expect(() => sqlite.importFromUnit(table)).toThrow(/domain_memory/u);
    expect([...table.entries()]).toHaveLength(2);
    expect(sqlite.listNamespaces()).toEqual([]);
  });
});
