import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { createSqliteMemoryProvider } from "../src/host/memory/sqlite.js";
import type { DomainMemoryProvider } from "../src/host/memory/registry.js";
import { fixedClock } from "./helpers/fakes.js";
import {
  FIXED_QUERIES,
  fixtureMemoryTable,
  productionShapedRecords,
} from "./helpers/memory-fixture.js";

/**
 * The parity gate of a storage migration.
 *
 * A deployment moves memory to another carrier to make writes cheaper. The one
 * thing it must not buy is a different answer: an expert that recalls another
 * set of notes — or the same set in another order — has changed behaviour, and
 * nothing in the deployment says so. This file runs the same fixed queries
 * through both providers over the same records and requires identical answers,
 * which is also the check to repeat on a real stand before switching it over.
 */

const directories: string[] = [];
const open: ReturnType<typeof createSqliteMemoryProvider>[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-memory-parity-"));
  directories.push(dir);
  return path.join(dir, "domain-experts-memory.db");
}

afterAll(() => {
  // A database left open holds its file on Windows, and the temp directory
  // would outlive the run.
  for (const provider of open) provider.close();
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

function pairOf(records = productionShapedRecords()): {
  readonly builtin: DomainMemoryProvider;
  readonly sqlite: DomainMemoryProvider;
} {
  const table = fixtureMemoryTable(records);
  const clock = fixedClock(1_758_000_000_000, 0);
  const sqlite = createSqliteMemoryProvider({
    filePath: tempDb(),
    now: clock,
  });
  open.push(sqlite);
  sqlite.importFromUnit(table);
  return {
    builtin: createBuiltinMemoryProvider(table, clock),
    sqlite,
  };
}

describe("memory parity: reads", () => {
  it("imports the fixture and answers with every record unchanged", async () => {
    const { builtin, sqlite } = pairOf();
    for (const namespace of ["domain/answer-reviewer", "domain/payments"]) {
      expect(await sqlite.inspect(namespace)).toEqual(
        await builtin.inspect(namespace),
      );
    }
    expect((await sqlite.inspect("domain/answer-reviewer")).length).toBe(27);
  });

  it("names the same namespaces in the same order", () => {
    const { builtin, sqlite } = pairOf();
    expect(sqlite.listNamespaces()).toEqual(builtin.listNamespaces());
    expect(sqlite.listNamespaces()).toEqual([
      "domain/answer-reviewer",
      "domain/payments",
      "domain/platform",
    ]);
  });

  it.each(FIXED_QUERIES.map((entry) => [entry.label, entry]))(
    "answers the %s query identically",
    async (_label, entry) => {
      const { builtin, sqlite } = pairOf();
      const query = {
        namespaces: entry.namespaces,
        query: entry.query,
        limit: entry.limit,
      };
      const before = await builtin.retrieve(query);
      const after = await sqlite.retrieve(query);
      expect(after).toEqual(before);
      if (entry.matches !== false) {
        expect(
          before.map((record) => `${record.namespace}/${record.key}`),
        ).not.toHaveLength(0);
      } else {
        expect(before).toHaveLength(0);
      }
    },
  );

  it("keeps the records a tie splits, split the same way", async () => {
    // The fixture ties two records to the millisecond inside one namespace. A
    // backend whose order depends on insertion history answers in the order it
    // happened to read, so both are pinned to the same tie-break.
    const { builtin, sqlite } = pairOf();
    const query = {
      namespaces: ["domain/answer-reviewer"],
      query: "",
      limit: 30,
    };
    const keys = (records: readonly { key: string }[]): string[] =>
      records.map((record) => record.key);
    expect(keys(await sqlite.retrieve(query))).toEqual(
      keys(await builtin.retrieve(query)),
    );
    const answers = await sqlite.retrieve(query);
    const tied = answers.filter(
      (record, index) =>
        index > 0 && record.updatedAt === answers[index - 1]?.updatedAt,
    );
    expect(tied.length).toBeGreaterThan(0);
  });
});

describe("memory parity: writes", () => {
  it("writes the same record through either provider", async () => {
    const { builtin, sqlite } = pairOf();
    const written = {
      namespace: "domain/payments",
      key: "new-cutoff",
      text: "Кutoff сменён: 15:00 вместо 14:00, см. PROJ-456.",
      tags: ["cutoff", "review", "cutoff"],
    };
    const first = await builtin.remember(
      written.namespace,
      written.key,
      written.text,
      written.tags,
    );
    const second = await sqlite.remember(
      written.namespace,
      written.key,
      written.text,
      written.tags,
    );
    expect(second).toEqual(first);
    expect(second.tags).toEqual(["cutoff", "review"]);
    expect(
      await sqlite.retrieve({
        namespaces: [written.namespace],
        query: "15:00",
        limit: 5,
      }),
    ).toEqual(
      await builtin.retrieve({
        namespaces: [written.namespace],
        query: "15:00",
        limit: 5,
      }),
    );
  });

  it("truncates an over-long text the same way and imports no new truncation", async () => {
    const records = productionShapedRecords();
    const { builtin, sqlite } = pairOf(records);
    const long = "длинный разбор ".repeat(2_000);
    const first = await builtin.remember("domain/platform", "long", long, []);
    const second = await sqlite.remember("domain/platform", "long", long, []);
    expect(second).toEqual(first);
    expect(second.text).toHaveLength(8_001);
    expect(second.text.endsWith("…")).toBe(true);
    // The fixture's own truncated record arrives as it was stored: an import
    // that re-ran the cap would shorten a record a year after it was written.
    const stored = await sqlite.inspect("domain/answer-reviewer");
    const truncated = stored.find(
      (record) => record.key === "review-long-answer-truncated",
    );
    expect(truncated?.text).toEqual(
      records.find((record) => record.key === "review-long-answer-truncated")
        ?.text,
    );
    expect(truncated?.text).toHaveLength(8_001);
  });

  it("keeps createdAt across a rewrite in either backend", async () => {
    const clock = fixedClock(1_758_000_000_000, 0);
    const table = fixtureMemoryTable();
    const builtin = createBuiltinMemoryProvider(table, clock);
    const sqlite = createSqliteMemoryProvider({
      filePath: tempDb(),
      now: clock,
    });
    open.push(sqlite);
    sqlite.importFromUnit(table);
    const original = (await builtin.inspect("domain/payments"))[0];
    if (original === undefined) throw new Error("fixture lost its records");
    const fromBuiltin = await builtin.remember(
      original.namespace,
      original.key,
      "обновлённый текст",
      ["review"],
    );
    const fromSqlite = await sqlite.remember(
      original.namespace,
      original.key,
      "обновлённый текст",
      ["review"],
    );
    expect(fromSqlite).toEqual(fromBuiltin);
    expect(fromSqlite.createdAt).toBe(original.createdAt);
    // Same clock, same reading: the rewrite did not invent a new timestamp.
    expect(await sqlite.inspect(original.namespace)).toEqual(
      await builtin.inspect(original.namespace),
    );
  });
});
