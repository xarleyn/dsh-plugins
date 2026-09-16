/**
 * `document_to_markdown` and the Docling client: extraction, image
 * materialization, OCR policy, refusal codes and Markdown normalization.
 */

import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import { createProviders } from "../src/documents/providers/registry.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { normalizeExtractedMarkdown } from "../src/documents/markdown/normalize.js";
import {
  docxBytes,
  pdfBytes,
  pngDataUri,
} from "./helpers/document-fixtures.js";
import { stubProviderSet } from "./helpers/document-providers.js";

let workspace: string;
const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

beforeEach(async () => {
  workspace = path.join(
    tmpdir(),
    `qa-docs-extract-${process.pid}-${Date.now()}`,
  );
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

interface FetchCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: FormData | undefined;
}

/** A docling-serve stand-in: one JSON answer, recorded request. */
function fakeDocling(options: {
  readonly payload?: unknown;
  readonly status?: number;
  readonly fail?: boolean;
  readonly health?: "ok" | "down";
}): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      body: init?.body instanceof FormData ? init.body : undefined,
    });
    if (url.endsWith("/health") || url.endsWith("/v1/health")) {
      return new Response("{}", {
        status: options.health === "down" ? 503 : 200,
      });
    }
    if (options.fail === true)
      throw new Error("connect ECONNREFUSED 10.0.0.5:5001");
    return new Response(
      options.payload === undefined ? "{}" : JSON.stringify(options.payload),
      {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function runtimeWithDocling(options: {
  readonly payload?: unknown;
  readonly status?: number;
  readonly fail?: boolean;
  readonly config?: Parameters<typeof resolveDocumentsConfig>[0];
  readonly health?: "ok" | "down";
}): { runtime: DocumentRuntime; calls: FetchCall[] } {
  const config = resolveDocumentsConfig({
    docling: { baseUrl: "http://docling.test" },
    ...options.config,
  });
  const fake = fakeDocling(options);
  const runtime = new DocumentRuntime({
    config,
    providers: createProviders(config, { fetchImpl: fake.fetchImpl }),
    now: () => FIXED_NOW,
  });
  return { runtime, calls: fake.calls };
}

const scope = (): { workspaceRoot: string; sessionId: string } => ({
  workspaceRoot: workspace,
  sessionId: "session-1",
});

async function writeInput(name: string, bytes: Buffer): Promise<string> {
  const target = path.join(workspace, name);
  await writeFile(target, bytes);
  return target;
}

describe("document_to_markdown", () => {
  test("extracts Markdown, keeps the input and reports the backend", async () => {
    const pdfPath = await writeInput("report.pdf", pdfBytes({ pages: 3 }));
    const { runtime, calls } = runtimeWithDocling({
      payload: {
        status: "success",
        document: { md_content: "# Отчёт\n\nТекст.\n", page_count: 3 },
      },
    });
    const result = await runtime.toMarkdown({ file: pdfPath }, scope());

    expect(result.markdown).toContain("# Отчёт");
    expect(result.backend).toBe("docling");
    expect(result.pages).toBe(3);
    expect(calls[0]?.url).toBe("http://docling.test/v1/convert/file");
    expect(calls[0]?.method).toBe("POST");

    const bundle = path.dirname(result.manifestPath);
    expect(await readdir(bundle).catch(() => [])).toContain("extracted.md");
    expect(await readdir(path.join(bundle, "input"))).toEqual(["report.pdf"]);
    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["operation"]).toBe("document_to_markdown");
    expect(manifest["input"]).toMatchObject({
      format: "pdf",
      filename: "report.pdf",
    });
    expect((manifest["outputs"] as { format: string }[])[0]?.format).toBe("md");
  });

  test("writes inline images out as assets and rewrites the references", async () => {
    const pdfPath = await writeInput("with-image.pdf", pdfBytes());
    const { runtime } = runtimeWithDocling({
      payload: {
        status: "success",
        document: {
          md_content: `# T\n\n![Схема](${pngDataUri()})\n`,
        },
      },
    });
    const result = await runtime.toMarkdown({ file: pdfPath }, scope());
    const bundle = path.dirname(result.manifestPath);
    expect(await readdir(path.join(bundle, "assets"))).toEqual([
      "image-001.png",
    ]);
    expect(result.markdown).toContain("![Схема](assets/image-001.png)");
    expect(await readFile(result.markdownPath, "utf8")).toContain(
      "assets/image-001.png",
    );
  });

  test("respects the image budget and says what it dropped", async () => {
    const pdfPath = await writeInput("many.pdf", pdfBytes());
    const { runtime } = runtimeWithDocling({
      config: { limits: { maxExtractedImages: 1 } },
      payload: {
        status: "success",
        document: {
          md_content: `![a](${pngDataUri()})\n\n![b](${pngDataUri()})\n`,
        },
      },
    });
    const result = await runtime.toMarkdown({ file: pdfPath }, scope());
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "IMAGE_SKIPPED",
    );
    expect(
      await readdir(path.join(path.dirname(result.manifestPath), "assets")),
    ).toEqual(["image-001.png"]);
  });

  test("reports OCR as a warning when it was forced", async () => {
    const pdfPath = await writeInput("scan.pdf", pdfBytes());
    const { runtime, calls } = runtimeWithDocling({
      payload: { status: "success", document: { md_content: "Скан\n" } },
    });
    const result = await runtime.toMarkdown(
      { file: pdfPath, ocr: "force" },
      scope(),
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "OCR_USED",
    );
    expect(calls[0]?.body?.get("force_ocr")).toBe("true");
  });

  test("never asks for OCR when the policy is off", async () => {
    const pdfPath = await writeInput("text.pdf", pdfBytes());
    const { runtime, calls } = runtimeWithDocling({
      payload: { status: "success", document: { md_content: "text\n" } },
    });
    await runtime.toMarkdown({ file: pdfPath, ocr: "off" }, scope());
    expect(calls[0]?.body?.get("do_ocr")).toBe("false");
  });

  test("maps extractor failures onto stable codes", async () => {
    const pdfPath = await writeInput("report.pdf", pdfBytes());
    await expect(
      runtimeWithDocling({ fail: true }).runtime.toMarkdown(
        { file: pdfPath },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    await expect(
      runtimeWithDocling({
        status: 500,
        payload: { detail: "boom" },
      }).runtime.toMarkdown({ file: pdfPath }, scope()),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    await expect(
      runtimeWithDocling({
        payload: { status: "failure", errors: [{ message: "bad page" }] },
      }).runtime.toMarkdown({ file: pdfPath }, scope()),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    await expect(
      runtimeWithDocling({ status: 503, payload: {} }).runtime.toMarkdown(
        { file: pdfPath },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  test("falls back to the fast extractor when the primary is unreachable", async () => {
    const pdfPath = await writeInput("report.pdf", pdfBytes());
    const config = resolveDocumentsConfig({
      markitdown: { enabled: true },
      extraction: { allowFallback: true },
    });
    const runtime = new DocumentRuntime({
      config,
      providers: {
        docx: stubProviderSet().providers.docx,
        typstPdf: undefined,
        converter: stubProviderSet().providers.converter,
        docling: {
          name: "docling",
          supports: () => true,
          extract: async () => {
            throw new DocumentError(
              "BACKEND_UNAVAILABLE",
              "docling is unreachable",
              {
                backend: "docling",
              },
            );
          },
        },
        doclingHealth: async () => "unavailable",
        markitdown: {
          name: "markitdown",
          supports: () => true,
          extract: async () => ({
            markdown: "# Fallback\n",
            assets: [],
            backend: { provider: "markitdown", version: "test" },
            warnings: [],
          }),
        },
        markitdownHealth: async () => "ok",
      },
      now: () => FIXED_NOW,
    });
    const result = await runtime.toMarkdown({ file: pdfPath }, scope());
    expect(result.backend).toBe("markitdown");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "BACKEND_FALLBACK_USED",
    );
  });

  test("does not fall back when the deployment forbids it", async () => {
    const pdfPath = await writeInput("report.pdf", pdfBytes());
    const config = resolveDocumentsConfig({
      markitdown: { enabled: true },
      extraction: { allowFallback: false },
    });
    const runtime = new DocumentRuntime({
      config,
      providers: {
        docx: stubProviderSet().providers.docx,
        typstPdf: undefined,
        converter: stubProviderSet().providers.converter,
        docling: {
          name: "docling",
          supports: () => true,
          extract: async () => {
            throw new DocumentError(
              "BACKEND_UNAVAILABLE",
              "docling is unreachable",
            );
          },
        },
        doclingHealth: async () => "unavailable",
        markitdown: {
          name: "markitdown",
          supports: () => true,
          extract: async () => ({
            markdown: "# Fallback\n",
            assets: [],
            backend: { provider: "markitdown" },
            warnings: [],
          }),
        },
        markitdownHealth: async () => "ok",
      },
    });
    await expect(
      runtime.toMarkdown({ file: pdfPath }, scope()),
    ).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
    });
  });

  test("refuses encrypted, macro-enabled and unsupported documents", async () => {
    const encrypted = await writeInput(
      "locked.pdf",
      pdfBytes({ encrypted: true }),
    );
    await expect(
      runtimeWithDocling({
        payload: { status: "success", document: { md_content: "x" } },
      }).runtime.toMarkdown({ file: encrypted }, scope()),
    ).rejects.toMatchObject({ code: "ENCRYPTED_DOCUMENT" });

    const macro = await writeInput(
      "report.docm",
      docxBytes({ macroEnabled: true }),
    );
    await expect(
      runtimeWithDocling({
        payload: { status: "success", document: { md_content: "x" } },
      }).runtime.toMarkdown({ file: macro }, scope()),
    ).rejects.toMatchObject({ code: "MACRO_ENABLED_DOCUMENT" });

    const zip = await writeInput(
      "slides.pptx",
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]),
    );
    await expect(
      runtimeWithDocling({
        payload: { status: "success", document: { md_content: "x" } },
      }).runtime.toMarkdown({ file: zip }, scope()),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  test("refuses a missing file, an oversized one and a path outside the workspace", async () => {
    const { runtime } = runtimeWithDocling({
      payload: { status: "success", document: { md_content: "x" } },
    });
    await expect(
      runtime.toMarkdown({ file: "missing.pdf" }, scope()),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
    await expect(
      runtime.toMarkdown({ file: "../../../etc/passwd" }, scope()),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

    const big = await writeInput("big.pdf", pdfBytes({ pages: 40 }));
    const tight = new DocumentRuntime({
      config: resolveDocumentsConfig({ limits: { maxInputBytes: 1024 } }),
      providers: createProviders(resolveDocumentsConfig(), {
        fetchImpl: fakeDocling({ payload: {} }).fetchImpl,
      }),
    });
    await expect(
      tight.toMarkdown({ file: big }, scope()),
    ).rejects.toMatchObject({
      code: "INPUT_TOO_LARGE",
    });
  });

  test("truncates the inline Markdown but keeps the whole text in the bundle", async () => {
    const pdfPath = await writeInput("long.pdf", pdfBytes());
    const body = `${"Абзац текста. ".repeat(500)}\n`;
    const { runtime } = runtimeWithDocling({
      config: { extraction: { maxInlineChars: 1000 } },
      payload: { status: "success", document: { md_content: body } },
    });
    const result = await runtime.toMarkdown({ file: pdfPath }, scope());
    expect(result.markdown.length).toBe(1000);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "MARKDOWN_TRUNCATED",
    );
    expect(
      (await readFile(result.markdownPath, "utf8")).length,
    ).toBeGreaterThanOrEqual(body.trim().length);
  });

  test("normalizes extracted text and keeps the input when retention says so", async () => {
    const pdfPath = await writeInput("report.pdf", pdfBytes());
    const raw = "# Заголовок\n\n• пункт один\n\n\n\n12\n\nХвост\n";
    const { runtime } = runtimeWithDocling({
      payload: { status: "success", document: { md_content: raw } },
    });
    const result = await runtime.toMarkdown(
      { file: pdfPath, outputFilename: "my report" },
      scope(),
    );
    expect(result.markdown).toContain("- пункт один");
    expect(result.markdown).not.toMatch(/\n{3,}/u);
    expect(result.markdown.endsWith("\n")).toBe(true);
    expect(path.basename(result.markdownPath)).toBe("my-report.md");

    const noInputs = new DocumentRuntime({
      config: resolveDocumentsConfig({ storage: { retainInputs: false } }),
      providers: createProviders(resolveDocumentsConfig(), {
        fetchImpl: fakeDocling({
          payload: { status: "success", document: { md_content: "x" } },
        }).fetchImpl,
      }),
    });
    const second = await noInputs.toMarkdown({ file: pdfPath }, scope());
    await expect(
      stat(path.join(path.dirname(second.manifestPath), "input")),
    ).rejects.toThrow();
  });
});

describe("markdown normalization", () => {
  test("drops running heads repeated across pages", () => {
    const source = [
      "Отчёт о тестировании",
      "",
      "Первый абзац.",
      "",
      "Отчёт о тестировании",
      "",
      "Второй абзац.",
      "",
      "Отчёт о тестировании",
      "",
      "Третий абзац.",
      "",
    ].join("\n");
    const result = normalizeExtractedMarkdown(source);
    expect(result.markdown).not.toContain("Отчёт о тестировании");
    expect(result.markdown).toContain("Третий абзац.");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "TABLE_EXTRACTION_DEGRADED",
    );
  });

  test("keeps headings and tables intact and normalizes platform artifacts", () => {
    const source = "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n## Итог\r\n";
    const result = normalizeExtractedMarkdown(source);
    expect(result.markdown).toContain("| --- | --- |");
    expect(result.markdown).toContain("## Итог");
    expect(result.markdown).not.toContain("\r");
  });
});
