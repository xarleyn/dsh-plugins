import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import type { SpreadsheetFormat } from "../src/documents/spreadsheets/types.js";
import {
  readZipEntries,
  readZipEntryByName,
} from "../src/documents/inspect/zip.js";
import { buildZip } from "./helpers/document-fixtures.js";

let workspace: string;
let runtime: DocumentRuntime;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "dsh-open-sheets-"));
  runtime = new DocumentRuntime({ config: resolveDocumentsConfig({}) });
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});
const scope = () => ({ workspaceRoot: workspace });

describe("delimited table reading", () => {
  test("detects separators even when records have different widths", async () => {
    await writeFile(
      path.join(workspace, "ragged-semicolon.csv"),
      "a;b;c\n001;2\nlast\n",
    );
    const page = await runtime.readSpreadsheet(
      { file: "ragged-semicolon.csv", sheet: "Data" },
      scope(),
    );
    expect(page.text?.delimiter).toBe(";");
    expect(page.rows[1]?.cells.map((cell) => cell.value)).toEqual([
      "001",
      "2",
      null,
    ]);
  });
  test("detects semicolon and preserves quotes, multiline fields, whitespace, blanks and leading zeroes", async () => {
    await writeFile(
      path.join(workspace, "input.csv"),
      '\uFEFFCode;Note;Flag\r\n0012;"first;second\nline ""quoted""";false\r\n;;\r\n  keep  ;tail;0\r\n',
    );
    const info = await runtime.inspectSpreadsheet(
      { file: "input.csv" },
      scope(),
    );
    expect(info).toMatchObject({
      format: "csv",
      text: { delimiter: ";", encoding: "utf-8" },
      sheets: [{ name: "Data", rows: 4, columns: 3 }],
    });
    const page = await runtime.readSpreadsheet(
      { file: "input.csv", sheet: "Data", rowCount: 2, text: info.text },
      scope(),
    );
    expect(page.rows[1]?.cells.map((cell) => cell.value)).toEqual([
      "0012",
      'first;second\nline "quoted"',
      "false",
    ]);
    expect(page.nextRow).toBe(3);
    const tail = await runtime.readSpreadsheet(
      { file: "input.csv", sheet: "Data", startRow: 3, text: info.text },
      scope(),
    );
    expect(tail.rows[0]?.cells.map((cell) => cell.value)).toEqual(["", "", ""]);
    expect(tail.rows[1]?.cells[0]?.value).toBe("  keep  ");
  });
  test.each(["utf-16le", "utf-16be"] as const)(
    "detects %s BOM",
    async (encoding) => {
      const bom =
        encoding === "utf-16le"
          ? Buffer.from([0xff, 0xfe])
          : Buffer.from([0xfe, 0xff]);
      await writeFile(
        path.join(workspace, "input.tsv"),
        Buffer.concat([
          bom,
          iconv.encode("Код\tЗначение\r\n001\tПример\r\n", encoding),
        ]),
      );
      const info = await runtime.inspectSpreadsheet(
        { file: "input.tsv" },
        scope(),
      );
      expect(info.text).toEqual({ delimiter: "\t", encoding });
      expect(
        (
          await runtime.readSpreadsheet(
            { file: "input.tsv", sheet: "Data" },
            scope(),
          )
        ).rows[1]?.cells[1]?.value,
      ).toBe("Пример");
    },
  );
  test("requires an explicit legacy encoding and reports it", async () => {
    await writeFile(
      path.join(workspace, "legacy.csv"),
      iconv.encode("Код;Имя\n001;Пример", "windows-1251"),
    );
    await expect(
      runtime.inspectSpreadsheet({ file: "legacy.csv" }, scope()),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    const page = await runtime.readSpreadsheet(
      { file: "legacy.csv", sheet: "Data", text: { encoding: "windows-1251" } },
      scope(),
    );
    expect(page.text).toEqual({ delimiter: ";", encoding: "windows-1251" });
    expect(page.rows[1]?.cells[1]?.value).toBe("Пример");
  });
  test("preserves ragged records and blank lines with an explicit delimiter", async () => {
    await writeFile(path.join(workspace, "ragged.csv"), "a,b,c\n\nx,y\nlast\n");
    const page = await runtime.readSpreadsheet(
      { file: "ragged.csv", sheet: "Data", text: { delimiter: "," } },
      scope(),
    );
    expect(page.rows).toHaveLength(4);
    expect(page.rows[1]?.cells[0]?.value).toBe("");
    expect(page.rows[2]?.cells.map((cell) => cell.value)).toEqual([
      "x",
      "y",
      null,
    ]);
  });
  test("refuses malformed quotes, ambiguous delimiters and wrong BOM declarations", async () => {
    await writeFile(path.join(workspace, "bad.csv"), 'a,b\n"unclosed,b');
    await expect(
      runtime.inspectSpreadsheet(
        { file: "bad.csv", text: { delimiter: "," } },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    await writeFile(path.join(workspace, "ambiguous.csv"), "a,b;c\n1,2;3");
    await expect(
      runtime.inspectSpreadsheet({ file: "ambiguous.csv" }, scope()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await writeFile(path.join(workspace, "bom.csv"), "\uFEFFa,b");
    await expect(
      runtime.inspectSpreadsheet(
        { file: "bom.csv", text: { encoding: "windows-1251" } },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("delimited table creation", () => {
  test.each(["csv", "tsv"] as const)(
    "creates readable %s with escaping and source manifest",
    async (format) => {
      const created = await runtime.createSpreadsheet(
        {
          format,
          filename: "table",
          sheets: [
            {
              name: "Input",
              rows: [
                ["Код", "Text"],
                ["0012", 'text,;\t"quoted"\nnext'],
                [null, false],
                ["=1+1", -2],
              ],
            },
          ],
        },
        scope(),
      );
      const file = created.files[0]!;
      expect(file.format).toBe(format);
      expect(file.path).toMatch(new RegExp(`\\.${format}$`, "u"));
      expect((await readFile(file.path)).subarray(0, 3)).toEqual(
        Buffer.from([0xef, 0xbb, 0xbf]),
      );
      const page = await runtime.readSpreadsheet(
        { file: file.path, sheet: "Data" },
        scope(),
      );
      expect(page.rows[1]?.cells[0]?.value).toBe("0012");
      expect(page.rows[1]?.cells[1]?.value).toBe('text,;\t"quoted"\nnext');
      expect(page.rows[2]?.cells.map((cell) => cell.value)).toEqual([
        "",
        "false",
      ]);
      expect(page.rows[3]?.cells[0]?.value).toBe("'=1+1");
      expect(page.rows[3]?.cells[1]?.value).toBe("-2");
      expect(
        JSON.parse(await readFile(created.manifestPath, "utf8")).files[0]
          .format,
      ).toBe(format);
    },
  );
  test("can export exact literal formula-looking text and UTF-16 without guessing types", async () => {
    const created = await runtime.createSpreadsheet(
      {
        format: "csv",
        text: { delimiter: ";", encoding: "utf-16le", escapeFormulas: false },
        sheets: [
          { name: "Data", rows: [["=literal", "001", { date: "2026-01-15" }]] },
        ],
      },
      scope(),
    );
    const page = await runtime.readSpreadsheet(
      { file: created.files[0]!.path, sheet: "Data" },
      scope(),
    );
    expect(page.rows[0]?.cells.map((cell) => cell.value)).toEqual([
      "=literal",
      "001",
      "2026-01-15",
    ]);
  });
  test("refuses multiple sheets, formula cells and lossy legacy encoding", async () => {
    await expect(
      runtime.createSpreadsheet(
        {
          format: "csv",
          sheets: [
            { name: "A", rows: [] },
            { name: "B", rows: [] },
          ],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      runtime.createSpreadsheet(
        {
          format: "tsv",
          sheets: [{ name: "A", rows: [[{ formula: "1+1", result: 2 }]] }],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      runtime.createSpreadsheet(
        {
          format: "csv",
          text: { encoding: "windows-1251" },
          sheets: [{ name: "A", rows: [["😀"]] }],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

const FODS = (tables: string) =>
  `<?xml version="1.0"?><o:document xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:x="urn:oasis:names:tc:opendocument:xmlns:text:1.0" o:version="1.3"><o:body><o:spreadsheet>${tables}</o:spreadsheet></o:body></o:document>`;
const cell = (text: string) =>
  `<t:table-cell o:value-type="string"><x:p>${text}</x:p></t:table-cell>`;

describe("OpenDocument spreadsheets", () => {
  test.each(["ods", "fods"] as const)(
    "creates %s with multiple sheets, real typed cells and OpenFormula caches",
    async (format) => {
      const created = await runtime.createSpreadsheet(
        {
          format,
          sheets: [
            {
              name: "Data",
              rows: [
                ["0012", 3, false, { date: "2026-01-15" }, '<&"\n\t  spaced'],
              ],
            },
            {
              name: "Summary",
              rows: [
                [{ formula: "of:=SUM([Data.B1])", result: 3 }],
                [{ formula: "of:=1+1" }],
              ],
            },
            { name: "Empty", rows: [] },
          ],
        },
        scope(),
      );
      const file = created.files[0]!;
      const info = await runtime.inspectSpreadsheet(
        { file: file.path },
        scope(),
      );
      expect(info.format).toBe(format);
      expect(info.sheets.map((sheet) => sheet.name)).toEqual([
        "Data",
        "Summary",
        "Empty",
      ]);
      const page = await runtime.readSpreadsheet(
        { file: file.path, sheet: "Data" },
        scope(),
      );
      expect(page.rows[0]?.cells.map((entry) => entry.value)).toEqual([
        "0012",
        3,
        false,
        "2026-01-15T00:00:00.000Z",
        '<&"\n\t  spaced',
      ]);
      const summary = await runtime.readSpreadsheet(
        { file: file.path, sheet: "Summary" },
        scope(),
      );
      expect(summary.rows[0]?.cells[0]).toMatchObject({
        formula: "of:=SUM([Data.B1])",
        value: 3,
      });
      expect(summary.rows[1]?.cells[0]?.value).toBeNull();
      if (format === "ods") {
        const bytes = await readFile(file.path);
        expect(readZipEntries(bytes)?.[0]).toMatchObject({
          name: "mimetype",
          compressionMethod: 0,
        });
        expect(
          readZipEntryByName(bytes, "META-INF/manifest.xml")?.toString(),
        ).toContain("content.xml");
      }
    },
  );
  test("reads an independently authored fixture with row groups, repeats, merges, spaces and trailing full-grid blanks", async () => {
    const xml = FODS(
      `<t:table t:name="Demo"><t:table-header-rows><t:table-row>${cell("Title")}</t:table-row></t:table-header-rows><t:table-row-group><t:table-row t:number-rows-repeated="2"><t:table-cell o:value-type="float" o:value="2" t:number-columns-repeated="2"/>${cell('a<x:s x:c="3"/>b<x:line-break/>c')}</t:table-row></t:table-row-group><t:table-row><t:table-cell t:number-columns-spanned="2" o:value-type="string"><x:p>Merged</x:p></t:table-cell><t:covered-table-cell/></t:table-row><t:table-row t:number-rows-repeated="1048572"><t:table-cell t:number-columns-repeated="16384"/></t:table-row></t:table>`,
    );
    await writeFile(path.join(workspace, "fixture.fods"), xml);
    const page = await runtime.readSpreadsheet(
      { file: "fixture.fods", sheet: "Demo" },
      scope(),
    );
    expect(page.sheet).toMatchObject({
      rows: 4,
      columns: 3,
      mergedRanges: ["A4:B4"],
    });
    expect(page.rows[1]?.cells.map((entry) => entry.value)).toEqual([
      2,
      2,
      "a   b\nc",
    ]);
    expect(page.rows[2]?.cells.map((entry) => entry.value)).toEqual([
      2,
      2,
      "a   b\nc",
    ]);
    expect(page.rows[3]?.cells[1]?.value).toBe("Merged");
  });
  test("refuses expansion bombs, declarations, scripts and encrypted containers", async () => {
    for (const [name, data, code] of [
      [
        "rows.fods",
        FODS(
          `<t:table t:name="Data"><t:table-row t:number-rows-repeated="999999999">${cell("x")}</t:table-row></t:table>`,
        ),
        "DOCUMENT_TOO_LARGE",
      ],
      [
        "columns.fods",
        FODS(
          '<t:table t:name="Data"><t:table-row><t:table-cell t:number-columns-repeated="999999999" o:value-type="float" o:value="1"/></t:table-row></t:table>',
        ),
        "DOCUMENT_TOO_LARGE",
      ],
      [
        "entity.fods",
        '<!DOCTYPE a [<!ENTITY bad "x">]>' + FODS(""),
        "INVALID_INPUT",
      ],
      [
        "script.fods",
        FODS('<o:scripts><o:script/></o:scripts><t:table t:name="Data"/>'),
        "MACRO_ENABLED_DOCUMENT",
      ],
    ]) {
      await writeFile(path.join(workspace, name!), data!);
      await expect(
        runtime.inspectSpreadsheet({ file: name! }, scope()),
      ).rejects.toMatchObject({ code });
    }
    await writeFile(
      path.join(workspace, "encrypted.ods"),
      buildZip([
        {
          name: "mimetype",
          data: "application/vnd.oasis.opendocument.spreadsheet",
        },
        { name: "content.xml", data: "encrypted" },
        {
          name: "META-INF/manifest.xml",
          data: "<manifest><encryption-data/></manifest>",
        },
      ]),
    );
    await expect(
      runtime.inspectSpreadsheet({ file: "encrypted.ods" }, scope()),
    ).rejects.toMatchObject({ code: "ENCRYPTED_DOCUMENT" });
  });
  test("requires explicit OpenFormula syntax and refuses mismatched format declarations", async () => {
    await expect(
      runtime.createSpreadsheet(
        {
          format: "ods",
          sheets: [
            { name: "Data", rows: [[{ formula: "SUM(A1:A2)", result: 2 }]] },
          ],
        },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const book = await runtime.createSpreadsheet(
      { sheets: [{ name: "Data", rows: [[1]] }] },
      scope(),
    );
    await expect(
      runtime.inspectSpreadsheet(
        { file: book.files[0]!.path, format: "csv" as SpreadsheetFormat },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
