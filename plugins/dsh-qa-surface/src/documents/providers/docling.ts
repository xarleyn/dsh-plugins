/**
 * Docling provider — the default DOCX/PDF → Markdown extractor (§6.1, §15).
 *
 * Docling runs as a separate HTTP service (`docling-serve`) rather than inside
 * the host process: it is the heaviest dependency of the pipeline, it is where
 * OCR happens, and keeping it across a network boundary is what lets the QA
 * image stay small (§21, §39).
 *
 * Two behaviours are deliberate:
 *
 * - images come back inline as base64 data URIs (the only representation that
 *   survives an HTTP boundary without a second fetch), and the extractor writes
 *   them out as real files under `assets/`, rewriting references to relative
 *   paths (§17.2);
 * - nothing about the response shape is assumed beyond "there is Markdown
 *   somewhere in it": a deployment upgrades docling-serve independently of
 *   this plugin, so both the wrapped (`document.md_content`) and flat
 *   (`md_content`) spellings are read.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { DocumentError, sanitizeBackendOutput } from "../errors.js";
import type {
  BackendStatus,
  DocumentExtractor,
  DocumentFormat,
  DocumentWarning,
  ExtractInput,
  ExtractedDocument,
} from "../types.js";
import { backendInfo } from "./shared.js";

export interface DoclingProviderOptions {
  /** Base URL of docling-serve, e.g. `http://docling:5001`. */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Cap on the response body the extractor will read. */
  readonly maxResponseBytes: number;
  readonly maxImages: number;
  /** Test seam and proxy hook; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const HEALTH_TIMEOUT_MS = 5_000;
const DATA_URI_PATTERN =
  /!\[([^\]]*)\]\(data:image\/(png|jpe?g|gif|webp|bmp|tiff);base64,([A-Za-z0-9+/=\s]+)\)/gu;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  tiff: "tiff",
};

function joinUrl(baseUrl: string, route: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${route}`;
}

export class DoclingExtractor implements DocumentExtractor {
  readonly name = "docling";

  constructor(private readonly options: DoclingProviderOptions) {}

  supports(_format: DocumentFormat): boolean {
    return true;
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  async health(): Promise<BackendStatus> {
    for (const route of ["/health", "/v1/health"]) {
      try {
        const response = await this.fetchImpl(
          joinUrl(this.options.baseUrl, route),
          {
            method: "GET",
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
          },
        );
        if (response.ok) return "ok";
      } catch {
        continue;
      }
    }
    return "unavailable";
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const warnings: DocumentWarning[] = [];
    const body = new FormData();
    const file = await import("node:fs/promises").then((fs) =>
      fs.readFile(input.inputPath),
    );
    body.append(
      "files",
      new Blob([new Uint8Array(file)], { type: "application/octet-stream" }),
      path.basename(input.inputPath),
    );
    body.append("to_formats", "md");
    body.append(
      "image_export_mode",
      input.extractImages ? "embedded" : "placeholder",
    );
    body.append("abort_on_error", "false");
    if (input.extractTables) body.append("table_mode", "accurate");
    if (input.ocr === "force") {
      body.append("do_ocr", "true");
      body.append("force_ocr", "true");
      warnings.push({
        code: "OCR_USED",
        message: "Document was processed using OCR.",
        backend: this.name,
      });
    } else if (input.ocr === "off") {
      body.append("do_ocr", "false");
    } else {
      // Let Docling decide per page; the service turns OCR on for pages that
      // carry no text layer.
      body.append("do_ocr", "true");
      body.append("force_ocr", "false");
    }
    for (const language of input.ocrLanguages ?? []) {
      const clean = language.trim();
      if (clean !== "") body.append("ocr_lang", clean);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        joinUrl(this.options.baseUrl, "/v1/convert/file"),
        {
          method: "POST",
          body,
          signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs),
        },
      );
    } catch (error) {
      const aborted = input.signal?.aborted === true;
      throw new DocumentError(
        aborted ? "BACKEND_TIMEOUT" : "BACKEND_UNAVAILABLE",
        aborted
          ? "the document extractor was cancelled"
          : `the document extractor is unreachable: ${sanitizeBackendOutput(
              error instanceof Error ? error.message : String(error),
            )}`,
        { backend: this.name, cause: error },
      );
    }

    if (!response.ok) {
      const detail = sanitizeBackendOutput(
        await response.text().catch(() => ""),
      );
      throw new DocumentError(
        response.status === 503 ? "BACKEND_UNAVAILABLE" : "EXTRACTION_FAILED",
        `the document extractor answered ${response.status}${detail === "" ? "" : `: ${detail}`}`,
        { backend: this.name, details: { status: response.status } },
      );
    }

    const raw = await response.text();
    if (raw.length > this.options.maxResponseBytes) {
      throw new DocumentError(
        "DOCUMENT_TOO_LARGE",
        "the extracted document exceeds the configured response budget",
        { backend: this.name, details: { bytes: raw.length } },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new DocumentError(
        "EXTRACTION_FAILED",
        "the document extractor returned a response that is not JSON",
        { backend: this.name, cause: error },
      );
    }

    const { markdown, pages, serviceVersion } = readDoclingPayload(
      payload,
      this.name,
    );
    const { text, assets } = await this.materializeAssets(
      markdown,
      input.assetsDir,
      input.extractImages,
      warnings,
    );
    if (input.preservePageMarkers && !/\f/u.test(text)) {
      warnings.push({
        code: "METADATA_PARTIALLY_EXTRACTED",
        message: "the extractor reported no page boundaries for this document",
        backend: this.name,
      });
    }
    return {
      markdown: text,
      assets,
      ...(pages === undefined ? {} : { pages }),
      backend: backendInfo(this.name, serviceVersion),
      warnings,
    };
  }

  /**
   * Write inline images out as files and rewrite the Markdown to reference
   * them relatively. Images beyond the configured cap are dropped with a
   * warning rather than silently inflating the artifact (§25).
   */
  private async materializeAssets(
    markdown: string,
    assetsDir: string,
    extractImages: boolean,
    warnings: DocumentWarning[],
  ): Promise<{
    text: string;
    assets: { path: string; mediaType: string }[];
  }> {
    const matches = [...markdown.matchAll(DATA_URI_PATTERN)];
    if (matches.length === 0) {
      if (extractImages && markdown.includes("data:image/")) {
        warnings.push({
          code: "IMAGE_SKIPPED",
          message: "images reported by the extractor could not be decoded",
          backend: this.name,
        });
      }
      return { text: markdown, assets: [] };
    }
    await mkdir(assetsDir, { recursive: true });
    const assets: { path: string; mediaType: string }[] = [];
    const replacements = new Map<string, string>();
    let index = 0;
    let skipped = 0;
    const { writeFile } = await import("node:fs/promises");
    for (const match of matches) {
      const [full, alt = "", mime = "png", base64 = ""] = match;
      if (index >= this.options.maxImages) {
        skipped += 1;
        replacements.set(full, alt);
        continue;
      }
      const extension = EXTENSION_BY_MIME[mime.toLowerCase()] ?? "bin";
      const fileName = `image-${String(index + 1).padStart(3, "0")}.${extension}`;
      const payload = Buffer.from(base64.replace(/\s+/gu, ""), "base64");
      if (payload.length === 0) {
        skipped += 1;
        replacements.set(full, alt);
        continue;
      }
      await writeFile(path.join(assetsDir, fileName), payload);
      assets.push({
        path: fileName,
        mediaType: `image/${extension === "jpg" ? "jpeg" : extension}`,
      });
      replacements.set(full, `![${alt}](assets/${fileName})`);
      index += 1;
    }
    let text = markdown;
    for (const [from, to] of replacements) {
      text = text.split(from).join(to);
    }
    if (skipped > 0) {
      warnings.push({
        code: "IMAGE_SKIPPED",
        message: `${skipped} image(s) were left out: the configured image budget is ${this.options.maxImages}`,
        backend: this.name,
        details: { skipped },
      });
    }
    if (!extractImages && assets.length > 0) {
      warnings.push({
        code: "IMAGE_SKIPPED",
        message:
          "extracted images were written anyway; extraction asked for none",
        backend: this.name,
      });
    }
    return { text, assets };
  }
}

interface DoclingPayload {
  readonly markdown: string;
  readonly pages?: number;
  readonly serviceVersion?: string;
}

/** Read the Markdown out of a docling-serve response, in either spelling. */
export function readDoclingPayload(
  payload: unknown,
  backend: string,
): DoclingPayload {
  if (payload === null || typeof payload !== "object") {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "the extractor returned no document",
      {
        backend,
      },
    );
  }
  const root = payload as Record<string, unknown>;
  const status = root["status"];
  if (typeof status === "string" && status.toLowerCase() !== "success") {
    const errors = Array.isArray(root["errors"])
      ? (root["errors"] as unknown[])
          .map((entry) => sanitizeBackendOutput(JSON.stringify(entry), 300))
          .join("; ")
      : "";
    throw new DocumentError(
      "EXTRACTION_FAILED",
      `the extractor reported "${status}"${errors === "" ? "" : `: ${errors}`}`,
      { backend, details: { status } },
    );
  }
  const document =
    root["document"] !== null && typeof root["document"] === "object"
      ? (root["document"] as Record<string, unknown>)
      : root;
  const markdown = document["md_content"] ?? document["markdown"];
  if (typeof markdown !== "string") {
    throw new DocumentError(
      "EXTRACTION_FAILED",
      "the extractor returned no Markdown content",
      { backend },
    );
  }
  const pagesSource =
    document["page_count"] ?? document["pages"] ?? root["page_count"];
  const pages = typeof pagesSource === "number" ? pagesSource : undefined;
  const version = root["version"] ?? document["version"];
  return {
    markdown,
    ...(pages === undefined ? {} : { pages }),
    ...(typeof version === "string" ? { serviceVersion: version } : {}),
  };
}
