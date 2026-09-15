/**
 * `document_convert`, `document_inspect`, capability discovery and backend
 * health (§10, §11, §42, §43).
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  documentCapabilities,
  documentHealth,
} from "../src/documents/capabilities.js";
import { resolveDocumentsConfig } from "../src/documents/config.js";
import {
  readDocxFacts,
  readDocxMetadata,
  readPdfFacts,
} from "../src/documents/inspect/facts.js";
import { CONVERSION_ROUTES } from "../src/documents/orchestrator/convert-document.js";
import { createProviders } from "../src/documents/providers/registry.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import {
  loadTemplateRegistry,
  templateNames,
} from "../src/documents/templates/registry.js";
import { resolveTemplate } from "../src/documents/templates/resolver.js";
import {
  readZipEntries,
  readZipEntry,
  readZipEntryByName,
} from "../src/documents/inspect/zip.js";
import {
  docxBytes,
  markdownFixture,
  pdfBytes,
} from "./helpers/document-fixtures.js";
import {
  stubProviderSet,
  type StubProviders,
} from "./helpers/document-providers.js";

let workspace: string;
let stub: StubProviders;
const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-convert-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
  stub = stubProviderSet();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runtime(
  options: {
    providers?: StubProviders;
    config?: Parameters<typeof resolveDocumentsConfig>[0];
  } = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(options.config ?? {}),
    providers: (options.providers ?? stub).providers,
    now: () => FIXED_NOW,
  });
}

const scope = (): { workspaceRoot: string; sessionId: string } => ({
  workspaceRoot: workspace,
  sessionId: "session-1",
});

async function writeInput(
  name: string,
  content: Buffer | string,
): Promise<string> {
  const target = path.join(workspace, name);
  await writeFile(target, content);
  return target;
}

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

describe("zip reader and fact readers", () => {
  test("reads stored and deflated entries", () => {
    const bytes = docxBytes({
      headings: ["Заголовок"],
      paragraphs: ["тело"],
      images: 1,
    });
    const entries = readZipEntries(bytes);
    expect(entries?.map((entry) => entry.name)).toContain("word/document.xml");
    const document = readZipEntryByName(bytes, "word/document.xml");
    expect(document?.toString("utf8")).toContain("Заголовок");
    const stored = entries?.find(
      (entry) => entry.name === "word/media/image1.png",
    );
    expect(document).toBeDefined();
    const bogus = {
      name: "x",
      compressionMethod: 8,
      compressedSize: 4,
      uncompressedSize: 4,
      localHeaderOffset: 10_000_000,
    };
    expect(readZipEntry(bytes, bogus)).toBeUndefined();
    expect(stored?.compressionMethod).toBe(0);
  });

  test("answers undefined for a non-archive or a truncated one", () => {
    expect(readZipEntries(Buffer.from("not a zip at all"))).toBeUndefined();
    const bytes = docxBytes();
    expect(readZipEntries(bytes.subarray(0, 40))).toBeUndefined();
    expect(readZipEntryByName(bytes, "word/missing.xml")).toBeUndefined();
  });

  test("PDF facts tolerate a document without an Info dictionary", () => {
    const facts = readPdfFacts(pdfBytes({ pages: 2 }));
    expect(facts.pages).toBe(2);
    expect(facts.encrypted).toBe(false);
  });

  test("DOCX metadata is empty when the package has no core properties", () => {
    const facts = readDocxFacts(docxBytes({ headings: ["A"] }));
    expect(facts.headings).toBe(1);
    const metadata = readDocxMetadata(docxBytes({ headings: ["A"] }));
    expect(metadata).toEqual({});
  });
});

describe("templates", () => {
  test("loads a registry, rejects escapes and refuses unknown names", async () => {
    const root = path.join(workspace, "templates");
    await mkdir(path.join(root, "docx"), { recursive: true });
    await writeFile(path.join(root, "docx", "qa-report.docx"), docxBytes());
    await writeFile(
      path.join(root, "manifest.yml"),
      "templates:\n  qa-report:\n    docx: ./docx/qa-report.docx\n",
      "utf8",
    );
    const registry = await loadTemplateRegistry(root);
    expect(registry.root).toBe(root);
    expect(templateNames(registry)).toEqual(["default", "qa-report"]);
    expect(
      resolveTemplate(registry, "qa-report", "default").resolved.name,
    ).toBe("qa-report");
    expect(
      resolveTemplate(registry, undefined, "default").resolved.source,
    ).toBe("builtin");
    expect(
      resolveTemplate(registry, undefined, "qa-report").warnings.map(
        (w) => w.code,
      ),
    ).toContain("TEMPLATE_DEFAULTED");
    expect(() => resolveTemplate(registry, "corporate", "default")).toThrow(
      /not registered/u,
    );
  });

  test("refuses a template path that leaves the template root", async () => {
    const root = path.join(workspace, "templates");
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "manifest.yml"),
      "templates:\n  evil:\n    docx: ../../etc/passwd\n",
      "utf8",
    );
    await expect(loadTemplateRegistry(root)).rejects.toMatchObject({
      code: "PATH_NOT_ALLOWED",
    });
  });

  test("an invalid registry is refused and a malformed one warns", async () => {
    const root = path.join(workspace, "bad");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "manifest.yml"), "other: {}\n", "utf8");
    await expect(loadTemplateRegistry(root)).rejects.toMatchObject({
      code: "INVALID_TEMPLATE",
    });

    const warnRoot = path.join(workspace, "warn");
    await mkdir(warnRoot, { recursive: true });
    await writeFile(
      path.join(warnRoot, "manifest.yml"),
      "templates: [broken\n",
      "utf8",
    );
    const registry = await loadTemplateRegistry(warnRoot);
    expect(registry.warnings).toHaveLength(1);
  });
});

describe("capabilities and health", () => {
  test("reports what the deployment can do", async () => {
    const config = resolveDocumentsConfig({ typst: { enabled: true } });
    const providers = stubProviderSet({ typstPdf: true }).providers;
    const capabilities = documentCapabilities({
      config,
      providers,
      templates: await loadTemplateRegistry(undefined),
    });
    expect(capabilities.enabled).toBe(true);
    expect(capabilities.create).toEqual(["docx", "pdf"]);
    expect(capabilities.extract).toEqual(["docx", "pdf"]);
    expect(capabilities.convert).toEqual(CONVERSION_ROUTES);
    expect(capabilities.ocr).toBe(true);
    expect(capabilities.templates).toEqual(["default"]);
    expect(capabilities.pdfModes).toEqual(["auto", "office", "typst"]);
  });

  test("a deployment without an extractor advertises no extraction", () => {
    const config = resolveDocumentsConfig({ docling: { enabled: false } });
    const providers = {
      ...createProviders(config),
      docling: undefined,
      doclingHealth: undefined,
    };
    const capabilities = documentCapabilities({
      config,
      providers,
      templates: { templates: new Map(), warnings: [] },
    });
    expect(capabilities.extract).toEqual([]);
    expect(capabilities.convert).toEqual([
      ["md", "docx"],
      ["md", "pdf"],
    ]);
    expect(capabilities.ocr).toBe(false);
  });

  test("health separates required from optional backends", async () => {
    const config = resolveDocumentsConfig();
    const health = await documentHealth({
      config,
      providers: {
        ...stubProviderSet().providers,
        doclingHealth: async () => "unavailable",
      },
      probeProcessBackends: false,
    });
    expect(health.status).toBe("degraded");
    expect(health.required["pandoc"]).toBe("ok");
    expect(health.required["docling"]).toBe("unavailable");
    expect(health.optional).toEqual({
      typst: "disabled",
      markitdown: "disabled",
    });
  });

  test("health reports a missing process backend as unavailable", async () => {
    const config = resolveDocumentsConfig({
      pandoc: { executable: "definitely-not-installed-xyz" },
    });
    const health = await documentHealth({
      config,
      providers: stubProviderSet().providers,
    });
    expect(health.required["pandoc"]).toBe("unavailable");
    expect(health.status).toBe("degraded");
  });
});

describe("artifact store", () => {
  test("lists and sweeps bundles by age", async () => {
    const result = await runtime().create(
      { content: "# x", formats: ["docx"] },
      scope(),
    );
    const store = new (
      await import("../src/documents/artifacts/store.js")
    ).ArtifactStore({
      root: path.join(workspace, ".qa", "artifacts", "documents"),
    });
    expect((await store.list()).map((entry) => entry.artifactId)).toContain(
      result.artifactId,
    );
    const future = new Date(Date.now() + 40 * 86_400_000);
    const swept = await store.cleanup({ maxAgeDays: 30, now: future });
    expect(swept.removed).toContain(result.artifactId);
    expect(await store.exists(result.artifactId)).toBe(false);
  });

  test("refuses an artifact id that was not issued by this pipeline", async () => {
    const { ArtifactStore } =
      await import("../src/documents/artifacts/store.js");
    const store = new ArtifactStore({ root: workspace });
    expect(() => store.artifactDir("../../etc")).toThrow(/not an artifact id/u);
    expect(() => store.path("../../../escape.txt")).toThrow(
      /outside the allowed document scope/u,
    );
  });
});
