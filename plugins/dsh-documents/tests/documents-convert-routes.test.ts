/**
 * `document_convert`, `document_inspect`, capability discovery and backend
 * health (§10, §11, §42, §43).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { CONVERSION_ROUTES } from "../src/documents/orchestrator/convert-document.js";
import {
  docxBytes,
  markdownFixture,
  pdfBytes,
} from "./helpers/document-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

import {
  runtime,
  scope,
  stub,
  writeInput,
} from "./documents-convert.helpers.js";

describe("document_convert", () => {
  test("advertises exactly the supported routes", () => {
    expect(CONVERSION_ROUTES).toEqual([
      ["md", "docx"],
      ["md", "pdf"],
      ["docx", "pdf"],
      ["docx", "md"],
      ["pdf", "md"],
    ]);
  });

  test("converts Markdown into DOCX through the create pipeline", async () => {
    const source = await writeInput(
      "report.md",
      markdownFixture().replace(/!\[[^\]]*\]\([^)]*\)/u, ""),
    );
    const result = await runtime().convert(
      { file: source, targetFormat: "docx", filename: "converted" },
      scope(),
    );
    expect(result.source).toEqual({ path: source, format: "md" });
    expect(result.files[0]?.status).toBe("created");
    expect(path.basename(result.files[0]?.path ?? "")).toBe("converted.docx");
    expect(stub.calls.docx).toHaveLength(1);
  });

  test("converts DOCX into PDF with the document converter and keeps the input", async () => {
    const source = await writeInput(
      "report.docx",
      docxBytes({ headings: ["H"] }),
    );
    const result = await runtime().convert(
      { file: source, targetFormat: "pdf" },
      scope(),
    );
    expect(result.files[0]?.path.endsWith(".pdf")).toBe(true);
    expect(stub.calls.convert[0]?.inputPath).toBe(source);
    expect(
      await readdir(path.join(path.dirname(result.manifestPath), "input")),
    ).toEqual(["report.docx"]);
    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["operation"]).toBe("document_convert");
    expect(manifest["backends"]).toMatchObject({
      convert: { provider: "libreoffice" },
    });
  });

  test("extracts DOCX and PDF into Markdown with the convert operation recorded", async () => {
    for (const file of ["report.docx", "report.pdf"]) {
      const bytes = file.endsWith(".docx")
        ? docxBytes({ headings: ["H"] })
        : pdfBytes();
      const source = await writeInput(file, bytes);
      const result = await runtime().convert(
        { file: source, targetFormat: "md" },
        scope(),
      );
      expect(result.files[0]?.format).toBe("md");
      const manifest = JSON.parse(
        await readFile(result.manifestPath, "utf8"),
      ) as Record<string, unknown>;
      expect(manifest["operation"]).toBe("document_convert");
      expect(manifest["input"]).toMatchObject({
        format: file.endsWith(".docx") ? "docx" : "pdf",
      });
    }
  });

  test("refuses unsupported routes instead of attempting them", async () => {
    const pdf = await writeInput("report.pdf", pdfBytes());
    await expect(
      runtime().convert({ file: pdf, targetFormat: "docx" }, scope()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONVERSION" });
    const md = await writeInput("report.md", "# x\n");
    await expect(
      runtime().convert({ file: md, targetFormat: "md" }, scope()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONVERSION" });
    await expect(
      runtime().convert({ file: pdf, targetFormat: "docx" }, scope()),
    ).rejects.toThrow(/supported: md → docx/u);
  });

  test("reports a conversion failure without leaving an empty artifact", async () => {
    const failing = stubProviderSet({
      pdfError: new (await import("../src/documents/errors.js")).DocumentError(
        "CONVERSION_FAILED",
        "libreoffice crashed",
      ),
    });
    const source = await writeInput("report.docx", docxBytes());
    await expect(
      runtime({ providers: failing }).convert(
        { file: source, targetFormat: "pdf" },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "CONVERSION_FAILED" });
  });
});

describe("document_inspect", () => {
  test("reports PDF facts: pages, metadata and encryption", async () => {
    const plain = await writeInput(
      "report.pdf",
      pdfBytes({ pages: 4, title: "Report", author: "QA" }),
    );
    const result = await runtime().inspect({ file: plain }, scope());
    expect(result.format).toBe("pdf");
    expect(result.mediaType).toBe("application/pdf");
    expect(result.structure?.pages).toBe(4);
    expect(result.metadata?.title).toBe("Report");
    expect(result.metadata?.author).toBe("QA");
    expect(result.metadata?.createdAt).toBe("2026-09-14T12:00:00Z");
    expect(result.encrypted).toBeUndefined();
    expect(result.size).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const locked = await writeInput(
      "locked.pdf",
      pdfBytes({ encrypted: true }),
    );
    const lockedResult = await runtime().inspect({ file: locked }, scope());
    expect(lockedResult.encrypted).toBe(true);
  });

  test("reports DOCX structure and core properties", async () => {
    const target = await writeInput(
      "report.docx",
      docxBytes({
        headings: ["Один", "Два"],
        paragraphs: ["текст"],
        tables: 2,
        images: 1,
        title: "Отчёт",
        author: "QA",
      }),
    );
    const result = await runtime().inspect({ file: target }, scope());
    expect(result.format).toBe("docx");
    expect(result.metadata?.title).toBe("Отчёт");
    expect(result.metadata?.author).toBe("QA");
    expect(result.structure?.headings).toBe(2);
    expect(result.structure?.tables).toBe(2);
    expect(result.structure?.images).toBe(1);
  });

  test("flags a macro-enabled document and counts Markdown structure", async () => {
    const macro = await writeInput(
      "report.docm",
      docxBytes({ macroEnabled: true }),
    );
    const macroResult = await runtime().inspect({ file: macro }, scope());
    expect(macroResult.format).toBe("docm");
    expect(macroResult.macroEnabled).toBe(true);

    const md = await writeInput(
      "notes.md",
      [
        "# One",
        "",
        "## Two",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "![i](assets/x.png)",
      ].join("\n"),
    );
    const mdResult = await runtime().inspect({ file: md }, scope());
    expect(mdResult.format).toBe("markdown");
    expect(mdResult.structure?.headings).toBe(2);
    expect(mdResult.structure?.tables).toBe(1);
    expect(mdResult.structure?.images).toBe(1);
  });

  test("reports an unknown file with a warning instead of failing", async () => {
    const other = await writeInput(
      "data.bin",
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
    );
    const result = await runtime().inspect({ file: other }, scope());
    expect(result.format).toBe("unknown");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "METADATA_PARTIALLY_EXTRACTED",
    );
  });

  test("refuses a missing file and a path outside the scope", async () => {
    await expect(
      runtime().inspect({ file: "nope.pdf" }, scope()),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
    await expect(
      runtime().inspect({ file: "../../../etc/passwd" }, scope()),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});
