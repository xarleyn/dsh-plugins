import {
  DocumentRuntime,
  resolveDocumentsConfig,
  type DocumentsFace,
  type SpreadsheetFormat,
} from "@yadsh/dsh-documents";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewSourceDocument,
  previewConvertibleDocument,
} from "../../src/provenance/document-preview.js";
import { readSourceFilePreview } from "../../src/provenance/file-preview.js";

let cwd: string;
let runtime: DocumentRuntime;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "qa-sheet-preview-"));
  runtime = new DocumentRuntime({ config: resolveDocumentsConfig({}) });
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});
function request(filePath: string) {
  return {
    filePath,
    cwd,
    sessionId: "demo",
    maxBytes: 100_000,
    documents: () => runtime as unknown as DocumentsFace,
  };
}
async function create(format: SpreadsheetFormat) {
  const result = await runtime.createSpreadsheet(
    {
      format,
      sheets: [
        { name: "Data", rows: [["0012", "<img src=x>", false]] },
        ...(format === "csv" || format === "tsv"
          ? []
          : [
              {
                name: "Summary",
                rows: [
                  [
                    {
                      formula:
                        format === "ods" || format === "fods"
                          ? "of:=1+1"
                          : "1+1",
                      result: 2,
                    },
                  ],
                ],
              },
            ]),
      ],
    },
    { workspaceRoot: cwd },
  );
  return result.files[0]!.path;
}
describe("native spreadsheet preview", () => {
  it.each(["xlsx", "csv", "tsv", "ods", "fods"] as const)(
    "opens %s through the document runtime without PDF conversion",
    async (format) => {
      const file = await create(format);
      const preview = await previewConvertibleDocument(request(file));
      expect(preview.kind).toBe("spreadsheet");
      if (preview.kind !== "spreadsheet") throw new Error("Expected cells");
      expect(preview.page.rows[0]?.cells.map((cell) => cell.value)).toEqual([
        "0012",
        "<img src=x>",
        format === "csv" || format === "tsv" ? "false" : false,
      ]);
      if (format !== "csv" && format !== "tsv") {
        const summary = await previewSourceDocument({
          ...request(file),
          selection: { sheet: "Summary" },
        });
        expect(summary).toMatchObject({
          kind: "spreadsheet",
          page: {
            sheet: { name: "Summary" },
            rows: [{ cells: [{ value: 2, type: "formula" }] }],
          },
        });
      }
    },
  );
  it("paginates wide and long sheets and rejects arbitrary selection, oversized responses and old providers", async () => {
    const created = await runtime.createSpreadsheet(
      {
        sheets: [
          {
            name: "Wide",
            rows: Array.from({ length: 65 }, (_, row) =>
              Array.from(
                { length: 27 },
                (_, column) => `${row + 1}:${column + 1}`,
              ),
            ),
          },
        ],
      },
      { workspaceRoot: cwd },
    );
    const req = request(created.files[0]!.path);
    expect(await previewSourceDocument(req)).toMatchObject({
      page: { nextRow: 41, nextColumn: 13 },
    });
    const last = await previewSourceDocument({
      ...req,
      selection: { sheet: "Wide", startRow: 41, startColumn: 25 },
    });
    expect(last).toMatchObject({ page: { nextRow: null, nextColumn: null } });
    if (last.kind !== "spreadsheet") throw new Error("Expected cells");
    expect(last.page.rows[0]?.cells[0]).toMatchObject({
      address: "Y41",
      value: "41:25",
    });
    expect(last.page.rows.at(-1)?.cells.at(-1)?.address).toBe("AA65");
    for (const selection of [
      { sheet: "Missing" },
      { startRow: -1 },
      { startColumn: 1.5 },
    ]) {
      await expect(
        previewSourceDocument({ ...req, selection }),
      ).rejects.toMatchObject({ reason: "unsupported" });
    }
    await expect(
      previewSourceDocument({ ...req, maxBytes: 10 }),
    ).rejects.toMatchObject({ reason: "unsupported" });
    await expect(
      previewSourceDocument({ ...req, documents: () => ({}) as DocumentsFace }),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });
  it("keeps root and evidence fences ahead of the parser, including text formats", async () => {
    const inspectSpreadsheet = vi.fn();
    const outside = await mkdtemp(join(tmpdir(), "qa-sheet-outside-"));
    try {
      await writeFile(join(outside, "outside.csv"), "name,value\na,1");
      await expect(
        previewSourceDocument({
          ...request(join(outside, "outside.csv")),
          documents: () => ({ inspectSpreadsheet }) as unknown as DocumentsFace,
        }),
      ).rejects.toMatchObject({ reason: "outside-roots" });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect(inspectSpreadsheet).not.toHaveBeenCalled();
    await writeFile(join(cwd, "source.csv"), "name,value\na,1");
    await expect(
      readSourceFilePreview({
        sourcePath: "source.csv",
        cwd,
        isEvidence: () => false,
        maxBytes: 1000,
        maxMarkdownRenderBytes: 1000,
      }),
    ).rejects.toMatchObject({ reason: "not-evidence" });
    await expect(
      readSourceFilePreview({
        sourcePath: "source.csv",
        cwd,
        isEvidence: () => true,
        maxBytes: 1000,
        maxMarkdownRenderBytes: 1000,
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });
});
