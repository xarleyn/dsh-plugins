import ExcelJS from "exceljs";
import JSZip from "jszip";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, expect, test } from "vitest";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { sha256Hex } from "../src/documents/artifacts/store.js";
import { parseXml } from "../src/documents/comparison/ooxml/xml.js";
import { editXlsx } from "../src/documents/spreadsheets/edit-xlsx.js";
import type {
  SpreadsheetEditInput,
  SpreadsheetEditResult,
} from "../src/documents/spreadsheets/types.js";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

let base: string, workspace: string, file: string, runtime: DocumentRuntime;
const scope = () => ({ workspaceRoot: workspace });
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "dsh-sheet-edit-"));
  workspace = path.join(base, "work");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspace);
  file = path.join(workspace, "source.xlsx");
  runtime = new DocumentRuntime({ config: resolveDocumentsConfig({}) });
  const book = new ExcelJS.Workbook();
  const data = book.addWorksheet("Data");
  data.addRows([
    ["Key", "Quantity"],
    ["0012", 3],
    ["untouched", { formula: "B2*2", result: 6 }],
  ]);
  data.getCell("A2").font = { bold: true, color: { argb: "FF112233" } };
  data.getColumn(1).width = 28;
  data.mergeCells("H1:I2");
  data.views = [{ state: "frozen", ySplit: 1 }];
  const hidden = book.addWorksheet("Hidden", { state: "veryHidden" });
  hidden.getCell("A1").value = "keep";
  book.addWorksheet("Empty");
  await book.xlsx.writeFile(file);
  const zip = await JSZip.loadAsync(await readFile(file));
  zip.file(
    "customXml/item1.xml",
    '<custom xmlns="urn:demo">keep objects</custom>',
  );
  zip.file(
    "xl/charts/chart9.xml",
    '<chart xmlns="urn:demo">keep chart</chart>',
  );
  zip.file("xl/media/image9.png", Buffer.from([1, 2, 3, 4]));
  await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
async function input(
  edits: SpreadsheetEditInput["edits"],
): Promise<SpreadsheetEditInput> {
  return { file, expectedSha256: sha256Hex(await readFile(file)), edits };
}
async function mutate(part: string, transform: (xml: string) => string) {
  const zip = await JSZip.loadAsync(await readFile(file));
  zip.file(part, transform(await zip.file(part)!.async("string")));
  await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
}
test("patches multiple sheets and sparse cells while preserving source, styles and unrelated ZIP parts", async () => {
  const before = await readFile(file);
  const result = await runtime.editSpreadsheet(
    await input([
      {
        sheet: "Data",
        startCell: "A2",
        rows: [
          [
            "0021",
            7,
            true,
            { date: "2026-02-03" },
            { formula: "B2*3", result: 21 },
            "=literal",
          ],
        ],
      },
      { sheet: "Data", startCell: "A3", rows: [[null]] },
      { sheet: "Hidden", startCell: "C4", rows: [["changed"]] },
      {
        sheet: "Empty",
        startCell: "B2",
        rows: [
          [1, 2],
          [3, 4],
        ],
      },
    ]),
    scope(),
  );
  expect(result.changedCells).toBe(12);
  expect(await readFile(file)).toEqual(before);
  expect(result.files[0]!.path).not.toBe(file);
  expect(path.basename(result.files[0]!.path)).toBe("source-edited.xlsx");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(result.files[0]!.path);
  const sheet = book.getWorksheet("Data")!;
  expect(sheet.getCell("A2").value).toBe("0021");
  expect(sheet.getCell("A2").font).toMatchObject({
    bold: true,
    color: { argb: "FF112233" },
  });
  expect(sheet.getCell("D2").value).toEqual(new Date("2026-02-03"));
  expect(sheet.getCell("E2").formula).toBe("B2*3");
  expect(sheet.getCell("E2").result).toBe(21);
  expect(sheet.getCell("F2").value).toBe("=literal");
  expect(sheet.getCell("A3").value).toBeNull();
  expect(sheet.getCell("B3").formula).toBe("B2*2");
  expect(book.getWorksheet("Hidden")!.state).toBe("veryHidden");
  expect(book.getWorksheet("Hidden")!.getCell("C4").value).toBe("changed");
  expect(book.getWorksheet("Empty")!.getCell("C3").value).toBe(4);
  const old = await JSZip.loadAsync(before),
    current = await JSZip.loadAsync(await readFile(result.files[0]!.path));
  const allowed = new Set([
    "xl/workbook.xml",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
    "xl/worksheets/sheet3.xml",
  ]);
  for (const [name, entry] of Object.entries(old.files))
    if (!entry.dir && !allowed.has(name))
      expect(await current.file(name)!.async("nodebuffer"), name).toEqual(
        await entry.async("nodebuffer"),
      );
  expect(await current.file("xl/workbook.xml")!.async("string")).toContain(
    'forceFullCalc="1"',
  );
  expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toMatchObject(
    {
      kind: "spreadsheet",
      source: { sha256: sha256Hex(before) },
      changedCells: 12,
    },
  );
});

test("source locations skip comments and CDATA, and handle prefixes and greater-than signs inside attributes", async () => {
  const xml =
    '<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><!-- <s:c r="A1"/> --><s:sheetData><s:row r="1" note="a>b"><s:c r="A1" t="inlineStr"><s:is><s:t><![CDATA[<fake/>]]></s:t></s:is></s:c></s:row></s:sheetData></s:worksheet>';
  await mutate("xl/worksheets/sheet1.xml", () => xml);
  const result = await editXlsx(await readFile(file), [
    { sheet: "Data", address: "A1", row: 1, column: 1, value: "<safe & text>" },
    { sheet: "Data", address: "B1", row: 1, column: 2, value: 8 },
  ]);
  const zip = await JSZip.loadAsync(result);
  const changed = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(changed).toContain('<!-- <s:c r="A1"/> -->');
  expect(changed).toContain('note="a>b"');
  expect(changed).toContain("&lt;safe &amp; text&gt;");
  expect(changed).toContain('<s:c r="B1"><s:v>8</s:v></s:c>');
  expect(() => parseXml(changed, true)).not.toThrow();
  const root = parseXml(xml, true).children.find((n) => n.kind === "element");
  expect(root?.kind === "element" && root.sourceRange?.end).toBe(xml.length);
  expect(parseXml(xml).children[0]).not.toHaveProperty("sourceRange");
});

test.each([
  [
    "occupied",
    [{ sheet: "Data", startCell: "A2", rows: [["no"]], onlyIfBlank: true }],
  ],
  [
    "overlap",
    [
      { sheet: "Data", startCell: "A1", rows: [[1, 2]] },
      { sheet: "Data", startCell: "B1", rows: [[3]] },
    ],
  ],
  ["merged", [{ sheet: "Data", startCell: "I1", rows: [["no"]] }]],
  ["sheet", [{ sheet: "Missing", startCell: "A1", rows: [[1]] }]],
  ["budget", [{ sheet: "Data", startCell: "XFE1", rows: [[1]] }]],
  ["NaN", [{ sheet: "Data", startCell: "A1", rows: [[NaN]] }]],
] as const)("refuses %s atomically", async (_name, edits) => {
  const original = await readFile(file);
  await expect(
    runtime.editSpreadsheet(await input(edits), scope()),
  ).rejects.toThrow();
  expect(await readFile(file)).toEqual(original);
  expect(
    await readdir(path.join(workspace, ".qa/artifacts/documents")).catch(
      () => [],
    ),
  ).toEqual([]);
});
test("refuses stale versions before creating output", async () => {
  const args = await input([{ sheet: "Data", startCell: "A1", rows: [[1]] }]);
  await mutate("xl/worksheets/sheet1.xml", (xml) =>
    xml.replace("<sheetData>", "<sheetData><!--new version-->"),
  );
  await expect(runtime.editSpreadsheet(args, scope())).rejects.toThrow(
    "Source changed",
  );
});
test.each([false, true])(
  "writes typed dates with the %s date1904 setting and preserves the base style",
  async (date1904) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(file);
    book.properties.date1904 = date1904;
    await book.xlsx.writeFile(file);
    const result = await runtime.editSpreadsheet(
      await input([
        {
          sheet: "Data",
          startCell: "A2",
          rows: [[{ date: "2026-05-06T12:30:00Z" }]],
        },
      ]),
      scope(),
    );
    const after = new ExcelJS.Workbook();
    await after.xlsx.readFile(result.files[0]!.path);
    expect(after.getWorksheet("Data")!.getCell("A2").value).toEqual(
      new Date("2026-05-06T12:30:00Z"),
    );
    expect(after.getWorksheet("Data")!.getCell("A2").font).toMatchObject({
      bold: true,
      color: { argb: "FF112233" },
    });
  },
);
test("inserts before a replaced row and before a replaced cell without reordering patches", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  book.getWorksheet("Hidden")!.getCell("C3").value = "old";
  await book.xlsx.writeFile(file);
  const result = await runtime.editSpreadsheet(
    await input([
      { sheet: "Hidden", startCell: "A2", rows: [["row2"]] },
      { sheet: "Hidden", startCell: "A3", rows: [["row3"]] },
      { sheet: "Hidden", startCell: "C3", rows: [["replacement"]] },
    ]),
    scope(),
  );
  const after = new ExcelJS.Workbook();
  await after.xlsx.readFile(result.files[0]!.path);
  expect(after.getWorksheet("Hidden")!.getCell("A2").value).toBe("row2");
  expect(after.getWorksheet("Hidden")!.getCell("A3").value).toBe("row3");
  expect(after.getWorksheet("Hidden")!.getCell("C3").value).toBe("replacement");
});
test.each(["protected", "array", "signed"])(
  "refuses %s workbooks or regions",
  async (kind) => {
    if (kind === "protected")
      await mutate("xl/worksheets/sheet1.xml", (xml) =>
        xml.replace("</worksheet>", '<sheetProtection sheet="1"/></worksheet>'),
      );
    if (kind === "array")
      await mutate("xl/worksheets/sheet1.xml", (xml) =>
        xml.replace("<f>", '<f t="array" ref="A2:B3">'),
      );
    if (kind === "signed") {
      const zip = await JSZip.loadAsync(await readFile(file));
      zip.file("_xmlsignatures/sig1.xml", "<signature/>");
      await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    }
    await expect(
      runtime.editSpreadsheet(
        await input([{ sheet: "Data", startCell: "A2", rows: [[1]] }]),
        scope(),
      ),
    ).rejects.toThrow();
  },
);

test("removes stale calculation chain entries and preserves other relationships", async () => {
  const zip = await JSZip.loadAsync(await readFile(file));
  zip.file(
    "xl/calcChain.xml",
    '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B3" i="1"/></calcChain>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    (await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(
      "</Relationships>",
      '<Relationship Id="rIdCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    ),
  );
  zip.file(
    "[Content_Types].xml",
    (await zip.file("[Content_Types].xml")!.async("string")).replace(
      "</Types>",
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
    ),
  );
  await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await runtime.editSpreadsheet(
    await input([{ sheet: "Data", startCell: "B3", rows: [[null]] }]),
    scope(),
  );
  const after = await JSZip.loadAsync(await readFile(result.files[0]!.path));
  expect(after.file("xl/calcChain.xml")).toBeNull();
  expect(
    await after.file("xl/_rels/workbook.xml.rels")!.async("string"),
  ).not.toContain("rIdCalc");
  expect(
    await after.file("[Content_Types].xml")!.async("string"),
  ).not.toContain("/xl/calcChain.xml");
});

test("edits a directly granted attachment, returns a readable new artifact and honors grant revocation", async () => {
  const attached = path.join(base, "upload.xlsx");
  await writeFile(attached, await readFile(file));
  const sibling = path.join(base, "other.xlsx");
  await writeFile(sibling, await readFile(file));
  let granted = true;
  const tool = createDocumentTools({
    runtime,
    extraInputRoots: (id) =>
      granted && id === "demo-session" ? [attached] : [],
  }).find((t) => t.name === "spreadsheet_edit")!;
  const exec = {
    agent: { session: { header: { cwd: workspace, id: "demo-session" } } },
  } as unknown as ToolRunContext;
  const args = {
    ...(await input([{ sheet: "Data", startCell: "B2", rows: [[9]] }])),
    file: attached,
  };
  const result = (await tool.execute(
    args as never,
    exec,
  )) as SpreadsheetEditResult;
  expect(path.isAbsolute(result.files[0]!.path)).toBe(false);
  const page = await runtime.readSpreadsheet(
    { file: result.files[0]!.path, sheet: "Data" },
    scope(),
  );
  expect(page.rows[1]!.cells[1]!.value).toBe(9);
  const rendered = tool.output.render(args as never, result as never);
  expect(JSON.stringify(rendered)).toContain("xlsx:");
  await expect(
    tool.execute({ ...args, file: sibling } as never, exec),
  ).rejects.toThrow();
  granted = false;
  await expect(tool.execute(args as never, exec)).rejects.toThrow();
});

test.each(["csv", "tsv"] as const)(
  "edits %s preserving leading zeroes, text fields and input bytes",
  async (format) => {
    const delimiter = format === "csv" ? ";" : "\t";
    file = path.join(workspace, `source.${format}`);
    const before = Buffer.from(
      ["0012", "=untouched", "change"].join(delimiter) + "\r\n",
    );
    await writeFile(file, before);
    const result = await runtime.editSpreadsheet(
      await input([{ sheet: "Data", startCell: "C1", rows: [["=unsafe"]] }]),
      scope(),
    );
    const page = await runtime.readSpreadsheet(
      { file: result.files[0]!.path, sheet: "Data" },
      scope(),
    );
    expect(page.rows[0]!.cells.map((c) => c.value)).toEqual([
      "0012",
      "=untouched",
      "'=unsafe",
    ]);
    expect(await readFile(file)).toEqual(before);
  },
);
test("refuses OpenDocument edits instead of rebuilding away styles", async () => {
  const created = await runtime.createSpreadsheet(
    { format: "ods", sheets: [{ name: "Data", rows: [[1]] }] },
    scope(),
  );
  file = created.files[0]!.path;
  await expect(
    runtime.editSpreadsheet(
      await input([{ sheet: "Data", startCell: "A1", rows: [[2]] }]),
      scope(),
    ),
  ).rejects.toThrow("Editing ODS/FODS is unsupported");
});
