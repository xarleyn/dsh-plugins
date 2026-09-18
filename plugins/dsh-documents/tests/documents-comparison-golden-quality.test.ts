import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { assessQuality } from "../src/documents/comparison/compare.js";
import { buildCanonicalDocument } from "../src/documents/comparison/canonical/document-ir.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { createDocumentTools } from "../src/documents/tools/index.js";
import { stubProviderSet } from "./helpers/document-providers.js";
import { pdfBytes } from "./helpers/document-fixtures.js";

describe("quality of lossy formats (§25)", () => {
  test("a DOCX pair is high quality, a generated text pair is not", () => {
    const native = buildCanonicalDocument({
      kind: "native-docx",
      extractor: "native-docx",
      nodes: [],
    });
    const ocr = buildCanonicalDocument({
      kind: "pdf-ocr",
      extractor: "docling",
      ocrUsed: true,
      nodes: [],
    });
    expect(assessQuality(native, native)).toMatchObject({
      level: "high",
      reasons: [],
      ocrUsed: false,
    });
    expect(assessQuality(ocr, ocr)).toMatchObject({
      level: "low",
      ocrUsed: true,
    });
    expect(assessQuality(ocr, ocr).reasons.join(" ")).toContain("OCR");
  });

  test("a cross-format pair is always low quality, and says why", () => {
    const docx = buildCanonicalDocument({
      kind: "native-docx",
      extractor: "native-docx",
      nodes: [],
    });
    const pdf = buildCanonicalDocument({
      kind: "pdf-text",
      extractor: "docling",
      nodes: [],
    });
    const quality = assessQuality(docx, pdf);
    expect(quality.level).toBe("low");
    expect(quality.reasons).toContain("cross-format comparison");
  });
});

describe("PDF comparison (§26 P1, §29)", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = path.join(
      tmpdir(),
      `qa-docs-compare-pdf-${process.pid}-${Date.now()}`,
    );
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /** A provider set whose PDF extraction answers per file. */
  function providersFor(
    answers: Readonly<Record<string, { markdown: string; ocr?: boolean }>>,
  ) {
    const stub = stubProviderSet();
    return {
      ...stub.providers,
      docling: {
        name: "docling",
        supports: () => true,
        extract: async (input: { inputPath: string }) => {
          const answer = answers[path.basename(input.inputPath)];
          if (answer === undefined) throw new Error("no answer configured");
          return {
            markdown: answer.markdown,
            assets: [],
            backend: { provider: "docling", version: "test" },
            warnings:
              answer.ocr === true
                ? [{ code: "OCR_USED" as const, message: "recognition used" }]
                : [],
          };
        },
      },
    };
  }

  async function comparePdfs(
    left: string,
    right: string,
    answers: Parameters<typeof providersFor>[0],
  ): Promise<Record<string, unknown>> {
    await writeFile(path.join(workspace, left), pdfBytes({ pages: 1 }));
    await writeFile(path.join(workspace, right), pdfBytes({ pages: 1 }));
    const runtime = new DocumentRuntime({
      config: resolveDocumentsConfig({}),
      providers: providersFor(answers),
      now: () => new Date("2026-09-14T10:00:00Z"),
    });
    const definition = createDocumentTools({ runtime }).find(
      (entry) => entry.name === "document_compare",
    );
    if (definition === undefined)
      throw new Error("document_compare is missing");
    return (await definition.execute(
      {
        left: { path: left },
        right: { path: right },
      },
      {
        signal: new AbortController().signal,
        agent: { session: { header: { cwd: workspace, id: "s" } } },
      } as never,
    )) as Record<string, unknown>;
  }

  test("a text-layer PDF pair compares at medium quality", async () => {
    const result = await comparePdfs("a.pdf", "b.pdf", {
      "a.pdf": { markdown: "# Договор\n\nСрок 10 дней.\n" },
      "b.pdf": { markdown: "# Договор\n\nСрок 30 дней.\n" },
    });
    expect(result.summary).toMatchObject({ replacements: 1, total: 1 });
    expect(result.quality).toMatchObject({
      level: "medium",
      leftExtraction: "docling",
      rightExtraction: "docling",
      ocrUsed: false,
    });
  });

  test("an OCR-derived PDF pair is low quality and says so", async () => {
    const result = await comparePdfs("a.pdf", "b.pdf", {
      "a.pdf": { markdown: "Срок 10 дней.", ocr: true },
      "b.pdf": { markdown: "Срок 30 дней.", ocr: true },
    });
    expect(result.quality).toMatchObject({ level: "low", ocrUsed: true });
    expect(
      (result.quality as { reasons: string[] }).reasons.join(" "),
    ).toContain("OCR");
    const preview = result.preview as { changeId: string; signals: string[] }[];
    expect(preview[0]?.signals).toContain("NUMBER_CHANGED");
  });

  test("a PDF without a backend is an unavailable backend, not a guess", async () => {
    await writeFile(path.join(workspace, "a.pdf"), pdfBytes({ pages: 1 }));
    await writeFile(path.join(workspace, "b.pdf"), pdfBytes({ pages: 1 }));
    const runtime = new DocumentRuntime({
      config: resolveDocumentsConfig({ docling: { enabled: false } }),
      providers: { ...stubProviderSet().providers, docling: undefined },
      now: () => new Date("2026-09-14T10:00:00Z"),
    });
    const definition = createDocumentTools({ runtime }).find(
      (entry) => entry.name === "document_compare",
    );
    await expect(
      definition?.execute(
        { left: { path: "a.pdf" }, right: { path: "b.pdf" } },
        {
          signal: new AbortController().signal,
          agent: { session: { header: { cwd: workspace, id: "s" } } },
        } as never,
      ),
    ).rejects.toThrow(/no enabled extractor/u);
  });
});
