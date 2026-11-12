import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, test } from "vitest";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import type { SpreadsheetChange } from "../src/documents/spreadsheets/query-types.js";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

let base: string,
  workspace: string,
  before: string,
  after: string,
  runtime: DocumentRuntime;
const scope = () => ({ workspaceRoot: workspace });
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "dsh-spreadsheet-query-"));
  workspace = path.join(base, "work");
  await mkdir(workspace);
  before = path.join(workspace, "before.xlsx");
  after = path.join(workspace, "after.xlsx");
  runtime = new DocumentRuntime({ config: resolveDocumentsConfig({}) });
  const book = new ExcelJS.Workbook();
  const data = book.addWorksheet("Data");
  data.addRows([
    ["Code", "Value"],
    ["0012", "Needle"],
    ["12", "needle"],
    ["x", { formula: '"needle"', result: "needle" }],
  ]);
  data.mergeCells("D2:E2");
  data.getCell("D2").value = "needle";
  const hidden = book.addWorksheet("Hidden", { state: "veryHidden" });
  hidden.getCell("B7").value = "NEEDLE";
  book.addWorksheet("Empty");
  await book.xlsx.writeFile(before);
  await writeFile(after, await readFile(before));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
async function change(action: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(before);
  action(book);
  await book.xlsx.writeFile(after);
}
const cellChanges = (changes: readonly SpreadsheetChange[]) =>
  changes.filter((c) => c.kind === "cell");

test("find includes hidden sheets in workbook/row/column order and does not duplicate merged slave cells", async () => {
  const result = await runtime.findSpreadsheet(
    { file: before, query: "needle", limit: 2 },
    scope(),
  );
  expect(result.totalMatches).toBe(5);
  expect(result.matches.map((m) => `${m.sheet}:${m.cell.address}`)).toEqual([
    "Data:B2",
    "Data:D2",
  ]);
  const addresses = result.matches.map((m) => `${m.sheet}:${m.cell.address}`);
  let cursor = result.nextCursor;
  while (cursor) {
    const page = await runtime.findSpreadsheet(
      { file: before, query: "needle", limit: 2, cursor },
      scope(),
    );
    expect(page.totalMatches).toBe(5);
    addresses.push(...page.matches.map((m) => `${m.sheet}:${m.cell.address}`));
    cursor = page.nextCursor;
  }
  expect(addresses).toEqual([
    "Data:B2",
    "Data:D2",
    "Data:B3",
    "Data:B4",
    "Hidden:B7",
  ]);
});
test("find supports exact/case/formula/range filters and preserves leading-zero identifiers", async () => {
  const exact = await runtime.findSpreadsheet(
    { file: before, query: "0012", match: "exact" },
    scope(),
  );
  expect(exact.matches.map((m) => m.cell.address)).toEqual(["A2"]);
  expect(exact.matches[0]!.cell.value).toBe("0012");
  const ranged = await runtime.findSpreadsheet(
    {
      file: before,
      query: "needle",
      sheets: ["Data"],
      range: "B2:B3",
      caseSensitive: true,
    },
    scope(),
  );
  expect(ranged.matches.map((m) => m.cell.address)).toEqual(["B3"]);
  const formula = await runtime.findSpreadsheet(
    { file: before, query: "needle", searchIn: "either", range: "B4" },
    scope(),
  );
  expect(formula.matches[0]!.matchedIn).toEqual(["value", "formula"]);
  expect(
    (await runtime.findSpreadsheet({ file: before, query: ".*" }, scope()))
      .totalMatches,
  ).toBe(0);
});
test("find cursors reject a changed source, changed query, forged payload and changed text interpretation", async () => {
  const first = await runtime.findSpreadsheet(
    { file: before, query: "needle", limit: 1 },
    scope(),
  );
  await expect(
    runtime.findSpreadsheet(
      { file: before, query: "x", cursor: first.nextCursor! },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
  await expect(
    runtime.findSpreadsheet(
      { file: before, query: "needle", cursor: "not-a-cursor" },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
  await change((book) => {
    book.getWorksheet("Data")!.getCell("A1").value = "updated";
  });
  await writeFile(before, await readFile(after));
  await expect(
    runtime.findSpreadsheet(
      { file: before, query: "needle", cursor: first.nextCursor! },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
  const csv = path.join(workspace, "data.csv");
  await writeFile(csv, "needle;needle\r\nneedle;needle\r\n");
  const page = await runtime.findSpreadsheet(
    { file: csv, query: "needle", limit: 1, text: { delimiter: ";" } },
    scope(),
  );
  await expect(
    runtime.findSpreadsheet(
      {
        file: csv,
        query: "needle",
        cursor: page.nextCursor!,
        text: { delimiter: "," },
      },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
});
test.each([
  { query: "" },
  { query: "x", sheets: ["Missing"] },
  { query: "x", sheets: ["Data", "Data"] },
  { query: "x", range: "B3:A1" },
  { query: "x", range: "XFE1" },
  { query: "x", limit: 201 },
  { query: "x", limit: 0 },
])("find validates inputs %j", async (options) => {
  await expect(
    runtime.findSpreadsheet({ file: before, ...options }, scope()),
  ).rejects.toThrow();
});

test("query previews and inline-budget pagination are explicit, without dropping matches", async () => {
  await change((book) => {
    const sheet = book.getWorksheet("Data")!;
    for (let r = 10; r < 25; r++)
      sheet.getCell(`A${r}`).value = "prefix" + "x".repeat(1000) + "TAIL";
  });
  const bounded = new DocumentRuntime({
    config: resolveDocumentsConfig({ extraction: { maxInlineChars: 4096 } }),
  });
  const options = { file: after, query: "TAIL", limit: 200 };
  let page = await bounded.findSpreadsheet(options, scope());
  let count = page.matches.length;
  expect(page.totalMatches).toBe(15);
  expect(page.matches.length).toBeLessThan(15);
  expect(page.matches[0]!.cell.truncatedFields).toContain("value");
  expect(page.matches[0]!.cell.value).not.toContain("TAIL");
  while (page.nextCursor) {
    page = await bounded.findSpreadsheet(
      { ...options, cursor: page.nextCursor },
      scope(),
    );
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(4096);
    count += page.matches.length;
  }
  expect(count).toBe(15);
});
test("diff defaults to semantic equality, includes full-value differences beyond identical previews and pages deterministically", async () => {
  const text = "x".repeat(600);
  await change((book) => {
    const sheet = book.getWorksheet("Data")!;
    sheet.getCell("A2").value = text + "old";
  });
  await writeFile(before, await readFile(after));
  await change((book) => {
    const sheet = book.getWorksheet("Data")!;
    sheet.getCell("A2").value = text + "new";
    sheet.getCell("B3").value = "changed";
    book.getWorksheet("Hidden")!.getCell("B7").value = null;
  });
  const result = await runtime.diffSpreadsheets(
    { before, after, limit: 1 },
    scope(),
  );
  expect(result.totalCellChanges).toBe(3);
  expect(result.totalChanges).toBeGreaterThanOrEqual(3);
  const all = [...result.changes];
  let cursor = result.nextCursor;
  while (cursor) {
    const page = await runtime.diffSpreadsheets(
      { before, after, limit: 1, cursor },
      scope(),
    );
    all.push(...page.changes);
    cursor = page.nextCursor;
  }
  const changes = cellChanges(all);
  expect(changes.map((c) => `${c.sheet}:${c.address}`)).toEqual([
    "Data:A2",
    "Data:B3",
    "Hidden:B7",
  ]);
  expect(changes[0]!.before.value).toBe(changes[0]!.after.value);
  expect(changes[0]!.valueChanged).toBe(true);
  expect(changes[0]!.before.truncatedFields).toContain("value");
});
test("diff distinguishes cache-only changes, expression changes and value types", async () => {
  await change((book) => {
    book.getWorksheet("Data")!.getCell("B4").value = {
      formula: '"needle"',
      result: "new cache",
    };
  });
  expect(
    (await runtime.diffSpreadsheets({ before, after }, scope()))
      .totalCellChanges,
  ).toBe(0);
  const cached = await runtime.diffSpreadsheets(
    { before, after, compareCachedResults: true },
    scope(),
  );
  expect(cached.totalCellChanges).toBe(1);
  expect(cellChanges(cached.changes)[0]!.formulaChanged).toBe(false);
  await change((book) => {
    const s = book.getWorksheet("Data")!;
    s.getCell("B4").value = { formula: '"changed"', result: "needle" };
    s.getCell("A3").value = 12;
  });
  const result = await runtime.diffSpreadsheets({ before, after }, scope());
  expect(result.totalCellChanges).toBe(2);
  expect(
    cellChanges(result.changes).find((c) => c.address === "B4")!.formulaChanged,
  ).toBe(true);
  expect(
    cellChanges(result.changes).find((c) => c.address === "A3")!.typeChanged,
  ).toBe(true);
});
test("formatting comparison finds font and styled-blank changes only when requested", async () => {
  await change((book) => {
    book.getWorksheet("Data")!.getCell("A2").font = { bold: true };
    book.getWorksheet("Data")!.getCell("C2").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF123456" },
    };
  });
  expect(
    (await runtime.diffSpreadsheets({ before, after }, scope()))
      .totalCellChanges,
  ).toBe(0);
  const result = await runtime.diffSpreadsheets(
    { before, after, compareFormatting: true },
    scope(),
  );
  expect(cellChanges(result.changes).map((c) => c.address)).toEqual([
    "A2",
    "C2",
  ]);
  expect(
    cellChanges(result.changes).every(
      (c) => c.formattingChanged && !c.valueChanged,
    ),
  ).toBe(true);
});
test("diff reports sheet addition/removal, visibility, merges and common-sheet order", async () => {
  await change((book) => {
    book.removeWorksheet("Empty");
    book.addWorksheet("Added").getCell("A1").value = "new";
    book.getWorksheet("Hidden")!.state = "visible";
    book.getWorksheet("Data")!.unMergeCells("D2:E2");
  });
  const zip = await JSZip.loadAsync(await readFile(after));
  const xml = await zip.file("xl/workbook.xml")!.async("string");
  const reordered = xml.replace(
    /(<sheet\b[^>]*\/>)(<sheet\b[^>]*\/>)/u,
    "$2$1",
  );
  expect(reordered).not.toBe(xml);
  zip.file("xl/workbook.xml", reordered);
  await writeFile(after, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await runtime.diffSpreadsheets({ before, after }, scope());
  expect(
    result.changes.some(
      (c) => c.kind === "sheet" && c.sheet === "Empty" && !c.after,
    ),
  ).toBe(true);
  expect(
    result.changes.some(
      (c) => c.kind === "sheet" && c.sheet === "Added" && !c.before,
    ),
  ).toBe(true);
  expect(result.changes.some((c) => c.kind === "sheet_order")).toBe(true);
  expect(
    result.changes.some((c) => c.kind === "sheet" && c.sheet === "Data"),
  ).toBe(true);
});
test("package comparison catches image changes outside the selected cell rectangle", async () => {
  const zip = await JSZip.loadAsync(await readFile(before));
  zip.file("xl/media/demo.png", Buffer.from([1, 2, 3]));
  await writeFile(before, await zip.generateAsync({ type: "nodebuffer" }));
  zip.file("xl/media/demo.png", Buffer.from([1, 2, 4]));
  await writeFile(after, await zip.generateAsync({ type: "nodebuffer" }));
  expect(
    (await runtime.diffSpreadsheets({ before, after }, scope())).totalChanges,
  ).toBe(0);
  const result = await runtime.diffSpreadsheets(
    { before, after, range: "A1", sheets: ["Data"], comparePackageParts: true },
    scope(),
  );
  expect(result.packagePartsCompared).toBe(true);
  expect(result.totalCellChanges).toBe(0);
  expect(result.totalPackageChanges).toBe(1);
  expect(result.changes[0]).toMatchObject({
    kind: "package_part",
    part: "xl/media/demo.png",
  });
});
test("diff continuation binds both files and comparison flags", async () => {
  await change((book) => {
    book.getWorksheet("Data")!.getCell("A2").value = "a";
    book.getWorksheet("Data")!.getCell("A3").value = "b";
  });
  const result = await runtime.diffSpreadsheets(
    { before, after, limit: 1 },
    scope(),
  );
  expect(result.nextCursor).not.toBeNull();
  await expect(
    runtime.diffSpreadsheets(
      {
        before,
        after,
        limit: 1,
        cursor: result.nextCursor!,
        compareFormatting: true,
      },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
  await expect(
    runtime.diffSpreadsheets(
      { before: after, after: before, cursor: result.nextCursor! },
      scope(),
    ),
  ).rejects.toThrow("Cursor");
});
test.each(["csv", "tsv", "ods", "fods"] as const)(
  "find/diff support %s and reject an unsupported package comparison",
  async (format) => {
    const old = await runtime.createSpreadsheet(
      { format, sheets: [{ name: "Data", rows: [["0012", "old"]] }] },
      scope(),
    );
    const next = await runtime.createSpreadsheet(
      { format, sheets: [{ name: "Data", rows: [["0012", "new"]] }] },
      scope(),
    );
    const a = old.files[0]!.path,
      b = next.files[0]!.path;
    expect(
      (
        await runtime.findSpreadsheet(
          { file: a, query: "0012", match: "exact" },
          scope(),
        )
      ).totalMatches,
    ).toBe(1);
    const result = await runtime.diffSpreadsheets(
      { before: a, after: b },
      scope(),
    );
    expect(result.totalCellChanges).toBe(1);
    expect(cellChanges(result.changes)[0]!.address).toBe("B1");
    await expect(
      runtime.diffSpreadsheets(
        { before: a, after: b, comparePackageParts: true },
        scope(),
      ),
    ).rejects.toThrow("requires two XLSX");
  },
);
test("real tool adapters reuse exact attachment grants for both diff inputs and honor revocation", async () => {
  const own = path.join(base, "upload.xlsx"),
    foreign = path.join(base, "other.xlsx");
  await writeFile(own, await readFile(before));
  await writeFile(foreign, await readFile(before));
  let granted = true;
  const tools = createDocumentTools({
    runtime,
    extraInputRoots: (id) => (granted && id === "session-a" ? [own] : []),
  });
  const exec = {
    agent: { session: { header: { cwd: workspace, id: "session-a" } } },
  } as unknown as ToolRunContext;
  const find = tools.find((t) => t.name === "spreadsheet_find")!,
    diff = tools.find((t) => t.name === "spreadsheet_diff")!;
  expect(
    await find.execute({ file: own, query: "needle" } as never, exec),
  ).toMatchObject({ totalMatches: 5 });
  expect(
    await diff.execute({ before: own, after } as never, exec),
  ).toMatchObject({ totalChanges: 0 });
  await expect(
    diff.execute({ before: own, after: foreign } as never, exec),
  ).rejects.toThrow();
  granted = false;
  await expect(
    find.execute({ file: own, query: "needle" } as never, exec),
  ).rejects.toThrow();
  expect(
    await readdir(path.join(workspace, ".qa/artifacts/documents")).catch(
      () => [],
    ),
  ).toEqual([]);
});
test("edit -> find -> diff workflow verifies the exact changed address", async () => {
  const source = await runtime.inspectSpreadsheet({ file: before }, scope());
  const result = await runtime.editSpreadsheet(
    {
      file: before,
      expectedSha256: source.sha256,
      edits: [{ sheet: "Data", startCell: "A2", rows: [["0099"]] }],
    },
    scope(),
  );
  const file = result.files[0]!.path;
  expect(
    (
      await runtime.findSpreadsheet(
        { file, query: "0099", match: "exact" },
        scope(),
      )
    ).matches[0]!.cell.address,
  ).toBe("A2");
  const diff = await runtime.diffSpreadsheets(
    { before, after: file, comparePackageParts: true },
    scope(),
  );
  expect(diff.totalCellChanges).toBe(1);
  expect(cellChanges(diff.changes)[0]).toMatchObject({
    sheet: "Data",
    address: "A2",
    before: { value: "0012" },
    after: { value: "0099" },
  });
});
