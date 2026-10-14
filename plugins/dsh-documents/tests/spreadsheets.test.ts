import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import type {
  SpreadsheetCreateInput,
  SpreadsheetCreateResult,
} from "../src/documents/spreadsheets/types.js";
import {
  SPREADSHEET_LIMITS,
  validateXlsx,
} from "../src/documents/spreadsheets/guards.js";
import { buildZip } from "./helpers/document-fixtures.js";
import { readZipEntryByName } from "../src/documents/inspect/zip.js";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

let workspace: string;
let runtime: DocumentRuntime;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "dsh-spreadsheets-"));
  runtime = new DocumentRuntime({ config: resolveDocumentsConfig({}) });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});
const scope = () => ({ workspaceRoot: workspace });
const exec = () =>
  ({
    agent: { session: { header: { cwd: workspace, id: "demo-session" } } },
  }) as unknown as ToolRunContext;
const input: SpreadsheetCreateInput = {
  filename: "../../report.xlsx",
  sheets: [
    {
      name: "Данные",
      headerRow: true,
      columnWidths: [25, 12],
      rows: [
        ["Code", "Quantity", "Active", "Date"],
        ["0012", 2, false, { date: "2026-01-15" }],
        [null, 3, true, "=literal"],
      ],
    },
    {
      name: "Summary",
      rows: [
        ["Total", { formula: "SUM('Данные'!B2:B3)", result: 5 }],
        ["Pending", { formula: "1+1" }],
      ],
    },
    { name: "Empty", rows: [] },
  ],
};

describe("XLSX artifact round trip", () => {
  test("creates a real multi-sheet workbook with typed cells and usable layout", async () => {
    const created = await runtime.createSpreadsheet(input, scope());
    const file = created.files[0]!;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.path);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Данные",
      "Summary",
      "Empty",
    ]);
    const sheet = workbook.getWorksheet("Данные")!;
    expect(sheet.getCell("A2").value).toBe("0012");
    expect(sheet.getCell("C2").value).toBe(false);
    expect(sheet.getCell("D2").value).toEqual(new Date("2026-01-15"));
    expect(sheet.getCell("D3").value).toBe("=literal");
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.getColumn(1).width).toBe(25);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:D1");
    expect(
      readZipEntryByName(
        await readFile(file.path),
        "xl/workbook.xml",
      )?.toString(),
    ).toContain('fullCalcOnLoad="1"');
    expect(path.basename(file.path)).toBe("report.xlsx");
    expect(
      JSON.parse(await readFile(created.manifestPath, "utf8")),
    ).toMatchObject({
      kind: "spreadsheet",
      files: [{ path: "report.xlsx", sha256: file.sha256 }],
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(path.dirname(file.path), "source.json"),
          "utf8",
        ),
      ),
    ).toEqual(input);
    const inspected = await runtime.inspectSpreadsheet(
      { file: file.path },
      scope(),
    );
    expect(inspected.sha256).toBe(file.sha256);
    expect(inspected.sheets[2]).toMatchObject({
      name: "Empty",
      rows: 0,
      columns: 0,
    });
    const page = await runtime.readSpreadsheet(
      { file: file.path, sheet: "Summary" },
      scope(),
    );
    expect(page.rows[0]?.cells[1]).toMatchObject({
      address: "B1",
      type: "formula",
      formula: "SUM('Данные'!B2:B3)",
      value: 5,
    });
    expect(page.rows[1]?.cells[1]).toMatchObject({
      type: "formula",
      value: null,
    });
  });

  test("reads pages across rows and columns without losing blanks or hidden sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hidden", { state: "hidden" });
    sheet.getCell("A1").value = "first";
    sheet.getCell("D3").value = 9;
    sheet.mergeCells("A4:B4");
    sheet.getCell("A4").value = "merged";
    sheet.getCell("C1").value = {
      richText: [{ text: "rich" }, { text: " text" }],
    };
    sheet.getCell("D1").value = {
      text: "Link",
      hyperlink: "https://example.com",
    };
    sheet.getCell("D2").value = { error: "#DIV/0!" };
    await workbook.xlsx.writeFile(path.join(workspace, "input.xlsx"));
    const inspected = await runtime.inspectSpreadsheet(
      { file: "input.xlsx" },
      scope(),
    );
    expect(inspected.sheets[0]).toMatchObject({
      state: "hidden",
      rows: 4,
      columns: 4,
      mergedRanges: ["A4:B4"],
    });
    const page = await runtime.readSpreadsheet(
      { file: "input.xlsx", sheet: "Hidden", rowCount: 2, columnCount: 2 },
      scope(),
    );
    expect(page.nextRow).toBe(3);
    expect(page.nextColumn).toBe(3);
    expect(page.rows[1]?.cells).toEqual([
      expect.objectContaining({ address: "A2", value: null }),
      expect.objectContaining({ address: "B2", value: null }),
    ]);
    const wide = await runtime.readSpreadsheet(
      { file: "input.xlsx", sheet: "Hidden", startColumn: 3 },
      scope(),
    );
    expect(wide.rows[0]?.cells).toEqual([
      expect.objectContaining({ value: "rich text" }),
      expect.objectContaining({
        value: "Link",
        hyperlink: "https://example.com",
      }),
    ]);
    expect(wide.rows[1]?.cells[1]).toMatchObject({
      type: "error",
      value: "#DIV/0!",
    });
    expect(wide.nextColumn).toBeNull();
    expect(wide.nextRow).toBeNull();
    await expect(
      runtime.readSpreadsheet(
        { file: "input.xlsx", sheet: "missing" },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("shortens pages to the inline budget and reports continuation", async () => {
    const created = await runtime.createSpreadsheet(
      {
        sheets: [
          {
            name: "Text",
            rows: Array.from({ length: 10 }, () => ["x".repeat(300)]),
          },
        ],
      },
      scope(),
    );
    const small = new DocumentRuntime({
      config: resolveDocumentsConfig({ extraction: { maxInlineChars: 2000 } }),
    });
    const page = await small.readSpreadsheet(
      { file: created.files[0]!.path, sheet: "Text", columnCount: 1 },
      scope(),
    );
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.length).toBeLessThan(10);
    expect(page.nextRow).toBe(page.rows.length + 1);
    expect(JSON.stringify(page).length).toBeLessThan(2000);
  });
});

describe("tool integration and session fences", () => {
  test("create results are reusable workspace paths; all schemas execute and render", async () => {
    const tools = createDocumentTools({ runtime });
    const create = tools.find((tool) => tool.name === "spreadsheet_create")!;
    const created = (await create.execute(
      input as unknown as Record<string, unknown>,
      exec(),
    )) as SpreadsheetCreateResult;
    expect(created.files[0]!.path).toMatch(
      /^\.qa\/artifacts\/documents\/doc_.*\/report\.xlsx$/u,
    );
    expect(
      JSON.stringify(create.output.render({}, created as never)),
    ).toContain("report.xlsx");
    const rendered = create.output.render({}, created as never) as {
      text: string;
    }[];
    expect(rendered[0]?.text).toMatch(
      /^xlsx: \.qa\/artifacts\/documents\/doc_.*\/report\.xlsx \(/u,
    );
    for (const name of ["spreadsheet_inspect", "spreadsheet_read"]) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      const value = await tool.execute(
        { file: created.files[0]!.path, sheet: "Данные" },
        exec(),
      );
      expect(JSON.stringify(tool.output.render({}, value as never))).toContain(
        "Данные",
      );
      await expect(
        tool.execute(
          { file: created.files[0]!.path, sheet: "Данные" },
          {} as ToolRunContext,
        ),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  test("pinned artifact root outputs remain readable by their returned paths", async () => {
    const pinned = new DocumentRuntime({
      config: resolveDocumentsConfig({
        storage: { root: path.join(workspace, "external") },
      }),
    });
    const session = path.join(workspace, "session");
    const context = {
      agent: { session: { header: { cwd: session } } },
    } as unknown as ToolRunContext;
    const tools = createDocumentTools({ runtime: pinned });
    const created = (await tools
      .find((t) => t.name === "spreadsheet_create")!
      .execute(
        input as unknown as Record<string, unknown>,
        context,
      )) as SpreadsheetCreateResult;
    expect(created.files[0]!.path).toMatch(/^doc_.*\/report\.xlsx$/u);
    await expect(
      tools
        .find((t) => t.name === "spreadsheet_inspect")!
        .execute({ file: created.files[0]!.path }, context),
    ).resolves.toMatchObject({ format: "xlsx" });
  });

  test("honours read-only attachment grants and rejects unrelated input paths", async () => {
    const created = await runtime.createSpreadsheet(input, scope());
    const isolated = path.join(workspace, "session");
    await expect(
      runtime.inspectSpreadsheet(
        { file: created.files[0]!.path },
        { workspaceRoot: isolated },
      ),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    const tools = createDocumentTools({
      runtime,
      extraInputRoots: () => [workspace],
    });
    const context = {
      agent: { session: { header: { cwd: isolated, id: "demo-session" } } },
    } as unknown as ToolRunContext;
    await expect(
      tools
        .find((t) => t.name === "spreadsheet_inspect")!
        .execute({ file: created.files[0]!.path }, context),
    ).resolves.toMatchObject({ format: "xlsx" });
  });

  test("creation obeys render authorization and cancellation", async () => {
    const authorizeRender = vi
      .fn()
      .mockRejectedValue(new Error("review required"));
    const tool = createDocumentTools({ runtime, authorizeRender }).find(
      (t) => t.name === "spreadsheet_create",
    )!;
    await expect(
      tool.execute(input as unknown as Record<string, unknown>, exec()),
    ).rejects.toThrow("review required");
    expect(authorizeRender).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.createSpreadsheet(input, {
        ...scope(),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe("workbook refusals", () => {
  test.each([
    { sheets: [] },
    {
      sheets: [
        { name: "Same", rows: [] },
        { name: "same", rows: [] },
      ],
    },
    { sheets: [{ name: "bad/name", rows: [] }] },
    { sheets: [{ name: "Data", rows: [[{ date: "2026-02-30" }]] }] },
    { sheets: [{ name: "Data", rows: [[{ formula: "" }]] }] },
    { sheets: [{ name: "Data", rows: [[Infinity]] }] },
  ])("rejects invalid creation input %#", async (bad) => {
    await expect(
      runtime.createSpreadsheet(bad as SpreadsheetCreateInput, scope()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("enforces the page and file-byte budgets", async () => {
    await expect(
      runtime.readSpreadsheet(
        {
          file: "missing.xlsx",
          sheet: "Data",
          rowCount: 1000,
          columnCount: 30,
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const small = new DocumentRuntime({
      config: resolveDocumentsConfig({ limits: { maxInputBytes: 1024 } }),
    });
    await writeFile(path.join(workspace, "big.xlsx"), Buffer.alloc(1025));
    await expect(
      small.inspectSpreadsheet({ file: "big.xlsx" }, scope()),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
  });

  test("rejects legacy bytes, macros, traversal, duplicate members and huge sparse coordinates before parsing", () => {
    expect(() => validateXlsx(Buffer.from("legacy XLS"))).toThrow(
      /UNSUPPORTED_FORMAT/u,
    );
    const base = { name: "xl/workbook.xml", data: "<workbook/>" };
    expect(() =>
      validateXlsx(
        buildZip([base, { name: "xl/vbaProject.bin", data: "macro" }]),
      ),
    ).toThrow(/MACRO_ENABLED_DOCUMENT/u);
    expect(() =>
      validateXlsx(buildZip([base, { name: "../file", data: "bad" }])),
    ).toThrow(/INVALID_INPUT/u);
    expect(() => validateXlsx(buildZip([base, base]))).toThrow(
      /INVALID_INPUT/u,
    );
    expect(() =>
      validateXlsx(
        buildZip([
          base,
          {
            name: "xl/worksheets/sheet1.xml",
            data: '<worksheet><row r="1048576"><c r="A1048576"/></row></worksheet>',
          },
        ]),
      ),
    ).toThrow(/DOCUMENT_TOO_LARGE/u);
    expect(() =>
      validateXlsx(
        buildZip([
          base,
          {
            name: "xl/worksheets/sheet1.xml",
            data: '<worksheet><mergeCells><mergeCell ref="A1:XFD100000"/></mergeCells></worksheet>',
          },
        ]),
      ),
    ).toThrow(/DOCUMENT_TOO_LARGE/u);
  });

  test("checks actual inflation even when ZIP headers lie about the size", () => {
    const bytes = buildZip([
      { name: "xl/workbook.xml", data: "<workbook/>" },
      {
        name: "payload.bin",
        data: Buffer.alloc(SPREADSHEET_LIMITS.expandedBytes + 1),
      },
    ]);
    for (let i = 0; i + 46 <= bytes.length; i += 1) {
      if (bytes.readUInt32LE(i) === 0x02014b50) bytes.writeUInt32LE(1, i + 24);
    }
    expect(() => validateXlsx(bytes)).toThrow(/INVALID_INPUT/u);
  });
  test("rejects oversized column declarations before workbook loading", () => {
    const bytes = buildZip([
      { name: "xl/workbook.xml", data: "<workbook/>" },
      {
        name: "xl/worksheets/sheet1.xml",
        data: '<worksheet><cols><col min="1" max="999999999" width="10"/></cols></worksheet>',
      },
    ]);
    expect(() => validateXlsx(bytes)).toThrow(/INVALID_INPUT/u);
  });
});
