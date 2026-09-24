import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  SQLITE_MEMORY_PROVIDER_ID,
  createSqliteMemoryProvider,
  type SqliteMemoryProvider,
} from "../src/host/memory/sqlite.js";
import { fixedClock } from "./helpers/fakes.js";
import {
  fixtureMemoryTable,
  productionShapedRecords,
} from "./helpers/memory-fixture.js";

/**
 * What the SQLite provider owes its callers, apart from answering like the
 * built-in one (that is `memory-parity.test.ts`).
 */

const directories: string[] = [];
const open: SqliteMemoryProvider[] = [];

function provider(
  now = fixedClock(1_758_000_000_000, 1_000),
): SqliteMemoryProvider {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-memory-sqlite-"));
  directories.push(dir);
  const created = createSqliteMemoryProvider({
    filePath: path.join(dir, "domain-experts-memory.db"),
    now,
  });
  open.push(created);
  return created;
}

afterAll(() => {
  for (const entry of open) entry.close();
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

describe("sqlite memory: registration", () => {
  it("presents itself as the provider a deployment selects by id", () => {
    const sqlite = provider();
    expect(sqlite.id).toBe(SQLITE_MEMORY_PROVIDER_ID);
    expect(sqlite.id).toMatch(/^[a-z][a-z0-9-]*$/u);
    expect(sqlite.builtin).toBe(false);
    expect(sqlite.title.length).toBeGreaterThan(0);
  });
});

describe("sqlite memory: writes", () => {
  it("keeps a record's identity in columns, so a crafted key cannot reach another namespace", async () => {
    const sqlite = provider();
    await sqlite.remember(
      "domain/payments",
      "domain/platform::secret",
      "Ключ выглядит как чужой namespace.",
      ["review"],
    );
    const intruder = await sqlite.retrieve({
      namespaces: ["domain/platform"],
      query: "namespace",
      limit: 10,
    });
    expect(intruder).toEqual([]);
    const own = await sqlite.inspect("domain/payments");
    expect(own.map((record) => record.key)).toEqual([
      "domain/platform::secret",
    ]);
  });

  it("refuses an empty key or text, the way the built-in provider does", async () => {
    const sqlite = provider();
    await expect(
      sqlite.remember("domain/payments", "  ", "text"),
    ).rejects.toThrowError(/non-empty key/u);
    await expect(
      sqlite.remember("domain/payments", "key", "   "),
    ).rejects.toThrowError(/non-empty text/u);
    expect(sqlite.listNamespaces()).toEqual([]);
  });

  it("forgets one record and reports whether it was there", async () => {
    const sqlite = provider();
    await sqlite.remember("domain/payments", "cutoff", "14:00", ["review"]);
    expect(await sqlite.forget("domain/payments", "cutoff")).toBe(true);
    expect(await sqlite.forget("domain/payments", "cutoff")).toBe(false);
    expect(await sqlite.inspect("domain/payments")).toEqual([]);
  });

  it("clears a namespace in one statement and leaves the neighbours alone", async () => {
    const sqlite = provider();
    sqlite.importFromUnit(fixtureMemoryTable(productionShapedRecords()));
    const before = (await sqlite.inspect("domain/payments")).length;
    expect(before).toBeGreaterThan(0);

    expect(await sqlite.clear("domain/payments")).toBe(before);
    expect(await sqlite.inspect("domain/payments")).toEqual([]);
    expect((await sqlite.inspect("domain/answer-reviewer")).length).toBe(27);
    expect(sqlite.listNamespaces()).toEqual([
      "domain/answer-reviewer",
      "domain/platform",
    ]);
  });
});

describe("sqlite memory: reads", () => {
  it("answers an empty database with nothing", async () => {
    const sqlite = provider();
    expect(sqlite.listNamespaces()).toEqual([]);
    expect(await sqlite.inspect("domain/payments")).toEqual([]);
    expect(
      await sqlite.retrieve({
        namespaces: ["domain/payments"],
        query: "anything",
        limit: 10,
      }),
    ).toEqual([]);
  });

  it("returns nothing for a query over no namespaces", async () => {
    const sqlite = provider();
    sqlite.importFromUnit(fixtureMemoryTable(productionShapedRecords()));
    expect(
      await sqlite.retrieve({ namespaces: [], query: "review", limit: 10 }),
    ).toEqual([]);
  });

  it("caps the limit the way the built-in provider does", async () => {
    const sqlite = provider();
    sqlite.importFromUnit(fixtureMemoryTable(productionShapedRecords()));
    const everything = await sqlite.retrieve({
      namespaces: ["domain/answer-reviewer"],
      query: "review",
      limit: 10_000,
    });
    expect(everything.length).toBeLessThanOrEqual(200);
    expect(everything.length).toBeGreaterThan(0);
    const nonsense = await sqlite.retrieve({
      namespaces: ["domain/answer-reviewer"],
      query: "review",
      limit: Number.NaN,
    });
    expect(nonsense.length).toBeLessThanOrEqual(20);
  });

  it("ranks a record matching three terms above one matching two", async () => {
    const sqlite = provider();
    await sqlite.remember(
      "domain/payments",
      "both",
      "settlement cutoff review note",
      [],
    );
    await sqlite.remember("domain/payments", "one", "settlement only", []);
    const found = await sqlite.retrieve({
      namespaces: ["domain/payments"],
      query: "settlement cutoff review",
      limit: 10,
    });
    expect(found.map((record) => record.key)).toEqual(["both", "one"]);
  });

  it("keeps the records across a reopen of the same file", async () => {
    const source = provider();
    const file = source.filePath;
    await source.remember("domain/payments", "cutoff", "14:00", [
      "review",
      "cutoff",
    ]);
    source.close();

    const again = createSqliteMemoryProvider({
      filePath: file,
      now: fixedClock(1_758_000_000_000, 1_000),
    });
    open.push(again);
    const records = await again.inspect("domain/payments");
    expect(records.map((record) => record.key)).toEqual(["cutoff"]);
    expect(records[0]?.tags).toEqual(["review", "cutoff"]);
    expect(again.listNamespaces()).toEqual(["domain/payments"]);
    expect(
      await again.retrieve({
        namespaces: ["domain/payments"],
        query: "cutoff",
        limit: 5,
      }),
    ).toHaveLength(1);
  });
});
