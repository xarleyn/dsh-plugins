/**
 * `document_from_url`: what happens around the fetch — the stored artifact, the
 * manifest that names the source, the refusals, and the budgets that keep a
 * large source out of the conversation.
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDocumentsConfig } from "../src/documents/config.js";
import { DocumentError } from "../src/documents/errors.js";
import {
  normalizeSourceUrl,
  type DocumentFetchSource,
} from "../src/documents/index.js";
import { DocumentRuntime } from "../src/documents/runtime.js";
import { DOCUMENT_FROM_URL_TOOL } from "../src/documents/tools/index.js";
import { stubProviderSet } from "./helpers/document-providers.js";

const FIXED_NOW = new Date("2026-09-14T10:00:00Z");

let workspace: string;

beforeEach(async () => {
  workspace = path.join(tmpdir(), `qa-docs-url-${process.pid}-${Date.now()}`);
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function runtime(
  fetchSource: DocumentFetchSource | undefined,
  config: Parameters<typeof resolveDocumentsConfig>[0] = {},
): DocumentRuntime {
  return new DocumentRuntime({
    config: resolveDocumentsConfig(config),
    providers: stubProviderSet().providers,
    now: () => FIXED_NOW,
    ...(fetchSource === undefined ? {} : { fetchSource }),
  });
}

/** A fetch seam answering one canned response; records what it was asked. */
function seam(response: {
  kind?: "html" | "text";
  content?: string;
  statusCode?: number;
  truncated?: boolean;
  fail?: Error;
}): { fetchSource: DocumentFetchSource; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchSource: async (url) => {
      urls.push(url);
      if (response.fail !== undefined) throw response.fail;
      return {
        url,
        statusCode: response.statusCode ?? 200,
        body: {
          kind: response.kind ?? "text",
          content: response.content ?? "# Документ\n\nТекст вложения.",
        },
        truncated: response.truncated ?? false,
      };
    },
  };
}

const scope = (): { workspaceRoot: string } => ({ workspaceRoot: workspace });

describe("document_from_url", () => {
  test("stores the fetched text with a manifest naming the source", async () => {
    const { fetchSource, urls } = seam({
      content: "# Регламент\n\nОдна ветка.",
    });
    const result = await runtime(fetchSource).fromUrl(
      {
        url: "https://w.corp/wiki/download/attachments/7/Регламент.docx?api=v2",
      },
      scope(),
    );

    expect(urls).toEqual([
      "https://w.corp/wiki/download/attachments/7/%D0%A0%D0%B5%D0%B3%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82.docx?api=v2",
    ]);
    expect(result.markdown).toContain("# Регламент");
    expect(result.sourceUrl).toContain("w.corp");
    expect(result.backend).toBe("web-fetch");
    expect(result.truncated).toBe(false);

    // The artifact keeps the whole text, and the manifest names the operation
    // and the source file, so an operator can trace the bundle back to the wiki.
    const stored = await readFile(result.markdownPath, "utf8");
    expect(stored).toContain("Одна ветка.");
    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as {
      operation: string;
      input: { format: string; filename?: string; bytes?: number };
      outputs: readonly { format: string }[];
    };
    expect(manifest.operation).toBe("document_from_url");
    expect(manifest.input.format).toBe("md");
    expect(manifest.input.filename).toBe("Регламент.docx");
    expect(manifest.outputs[0]?.format).toBe("md");
  });

  test("an HTML response is refused, not stored", async () => {
    const { fetchSource } = seam({
      kind: "html",
      content: "<html>page</html>",
    });
    await expect(
      runtime(fetchSource).fromUrl(
        { url: "https://w.corp/wiki/pages/7" },
        scope(),
      ),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      message: expect.stringContaining("HTML page") as unknown as string,
    });
  });

  test("the fetch layer's own refusal reaches the model", async () => {
    const { fetchSource } = seam({
      fail: new Error(
        '"report.pdf" cannot be read: the .pdf format is not extracted',
      ),
    });
    const failure = (await runtime(fetchSource)
      .fromUrl({ url: "https://w.corp/download/7/report.pdf" }, scope())
      .then(
        () => undefined,
        (error: unknown) => error as DocumentError,
      )) as DocumentError;
    expect(failure.code).toBe("EXTRACTION_FAILED");
    expect(failure.message).toContain(".pdf format is not extracted");
  });

  test("without a web provider the tool says so instead of guessing", async () => {
    await expect(
      runtime(undefined).fromUrl(
        { url: "https://w.corp/download/7/a.docx" },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  test("a relative or non-http URL is rejected before any fetch", async () => {
    const { fetchSource, urls } = seam({});
    await expect(
      runtime(fetchSource).fromUrl({ url: "file:///etc/passwd" }, scope()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      runtime(fetchSource).fromUrl({ url: "w.corp/a.docx" }, scope()),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(urls).toEqual([]);
    expect(normalizeSourceUrl(" https://w.corp/a.docx ")).toBe(
      "https://w.corp/a.docx",
    );
  });

  test("a long source is truncated for the response and kept whole in the artifact", async () => {
    const long = "x".repeat(5_000);
    const { fetchSource } = seam({ content: long });
    const result = await runtime(fetchSource, {
      extraction: { maxInlineChars: 1_000 },
    }).fromUrl({ url: "https://w.corp/a.txt" }, scope());

    expect(result.markdown.length).toBe(1_000);
    expect(result.truncated).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "MARKDOWN_TRUNCATED",
    );
    // The store normalizes the file (a trailing newline), not the content.
    expect((await readFile(result.markdownPath, "utf8")).trimEnd().length).toBe(
      5_000,
    );
  });

  test("a provider-capped response is reported as truncated", async () => {
    const { fetchSource } = seam({ content: "partial", truncated: true });
    const result = await runtime(fetchSource).fromUrl(
      { url: "https://w.corp/a.txt" },
      scope(),
    );
    expect(result.truncated).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "MARKDOWN_TRUNCATED",
    );
  });

  test("the tool advertises its name and stores under a chosen filename", async () => {
    const { fetchSource } = seam({ content: "текст" });
    const result = await runtime(fetchSource).fromUrl(
      { url: "https://w.corp/a.txt", outputFilename: "attachment.md" },
      scope(),
    );
    expect(path.basename(result.markdownPath)).toBe("attachment.md");
    expect(DOCUMENT_FROM_URL_TOOL).toBe("document_from_url");
  });
});
