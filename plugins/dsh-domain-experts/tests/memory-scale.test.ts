import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createBuiltinMemoryProvider } from "../src/host/memory/builtin.js";
import { createSqliteMemoryProvider } from "../src/host/memory/sqlite.js";
import { fixedClock } from "./helpers/fakes.js";
import {
  recordsForSize,
  rewritingJsonTable,
} from "./helpers/memory-fixture.js";

/**
 * The acceptance numbers for moving a domain's memory onto SQLite.
 *
 * The claim under test is the reason for the change: a write whose cost grows
 * with everything ever written. Numbers go to the plan document, so this run is
 * opt-in rather than part of every CI job — the points are sized to finish in
 * seconds, and timing assertions are kept to the shape of the curve, not to a
 * millisecond a loaded machine could miss.
 *
 *     DSH_MEASURE_MEMORY=1 pnpm --filter @yadsh/dsh-domain-experts test
 */
const measure = process.env.DSH_MEASURE_MEMORY === "1";

const POINTS: readonly { readonly size: number; readonly writes: number }[] = [
  { size: 30, writes: 200 },
  { size: 500, writes: 100 },
  { size: 5_000, writes: 20 },
];

/** Where `clear(namespace)` is measured: the JSON path deletes row by row. */
const CLEAR_SIZES = new Set([30, 500]);

const directories: string[] = [];

function tempFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-memory-scale-"));
  directories.push(dir);
  return path.join(dir, name);
}

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

async function asyncTimed(work: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

describe.skipIf(!measure)("memory scale", () => {
  it("reports what a write costs as the table grows", async () => {
    const rows: string[] = [
      "records | writes | json ms/write | json document | sqlite ms/write",
    ];
    const measured: {
      size: number;
      jsonPerWrite: number;
      sqlitePerWrite: number;
      bytes: number;
      jsonClear?: number;
      sqliteClear?: number;
    }[] = [];

    for (const point of POINTS) {
      const records = recordsForSize(point.size, "domain/answer-reviewer");
      let bytes = 0;
      const jsonTable = rewritingJsonTable(records, (written) => {
        bytes = written;
      });
      const builtin = createBuiltinMemoryProvider(
        jsonTable,
        fixedClock(1_758_000_000_000, 0),
      );
      const jsonMs = await asyncTimed(async () => {
        for (let index = 0; index < point.writes; index += 1) {
          await builtin.remember(
            "domain/answer-reviewer",
            `write-${String(index)}`,
            "Замер записи поверх уже накопленного.",
            ["review"],
          );
        }
      });

      const sqlite = createSqliteMemoryProvider({
        filePath: tempFile("memory.db"),
        now: fixedClock(1_758_000_000_000, 0),
      });
      sqlite.importFromUnit(jsonTable);
      const sqliteMs = await asyncTimed(async () => {
        for (let index = 0; index < point.writes; index += 1) {
          await sqlite.remember(
            "domain/answer-reviewer",
            `write-${String(index)}`,
            "Замер записи поверх уже накопленного.",
            ["review"],
          );
        }
      });
      sqlite.close();

      const entry = {
        size: point.size,
        writes: point.writes,
        jsonPerWrite: jsonMs / point.writes,
        sqlitePerWrite: sqliteMs / point.writes,
        bytes,
      };
      measured.push(entry);
      rows.push(
        `${String(point.size).padStart(7)} | ${String(point.writes).padStart(6)} | ${entry.jsonPerWrite
          .toFixed(3)
          .padStart(13)} | ${(Math.round(bytes / 1024) * 1024).toLocaleString(
          "en",
        )} | ${entry.sqlitePerWrite.toFixed(3).padStart(14)}`,
      );
    }

    for (const point of POINTS.filter((each) => CLEAR_SIZES.has(each.size))) {
      const records = recordsForSize(point.size, "domain/answer-reviewer");
      const jsonTable = rewritingJsonTable(records, () => undefined);
      const builtin = createBuiltinMemoryProvider(
        jsonTable,
        fixedClock(1_758_000_000_000, 0),
      );
      const jsonMs = await asyncTimed(async () => {
        await builtin.clear("domain/answer-reviewer");
      });
      const sqlite = createSqliteMemoryProvider({
        filePath: tempFile("clear.db"),
        now: fixedClock(1_758_000_000_000, 0),
      });
      sqlite.importFromUnit(jsonTable);
      const sqliteMs = await asyncTimed(async () => {
        await sqlite.clear("domain/answer-reviewer");
      });
      sqlite.close();
      rows.push(
        `clear(${String(point.size)}) json ${jsonMs.toFixed(0)} ms | sqlite ${sqliteMs.toFixed(
          0,
        )} ms`,
      );
    }
    rows.push(
      `clear(5000) json: not measured — ${String(
        POINTS[2]?.writes,
      )} writes already cost ${(measured[2]?.jsonPerWrite ?? 0).toFixed(
        0,
      )} ms each because the document is rewritten whole`,
    );

    for (const line of rows) console.info(line);

    const smallest = measured[0];
    const largest = measured[measured.length - 1];
    if (smallest === undefined || largest === undefined) {
      throw new Error("the measurement run produced no points");
    }
    // The shape, not the millisecond: the JSON path costs more per write as the
    // document grows, and the row path does not follow it.
    expect(largest.jsonPerWrite).toBeGreaterThan(smallest.jsonPerWrite * 10);
    expect(largest.sqlitePerWrite).toBeLessThan(largest.jsonPerWrite);
  });
});
