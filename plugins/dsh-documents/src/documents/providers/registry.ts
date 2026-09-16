/**
 * Backend registry and selection (§22, §23, §14.3, §45).
 *
 * Tools never import a concrete provider: they ask the registry for the
 * renderer, extractor or converter that fits the request, and the registry
 * decides — from configuration and from what is actually available — which
 * implementation that is. Swapping Docling for another extractor, or Typst for
 * another PDF engine, is a change here and nowhere else.
 */

import { DocumentError } from "../errors.js";
import type { ResolvedDocumentsConfig } from "../config.js";
import type {
  BackendStatus,
  DocumentConverter,
  DocumentExtractor,
  DocumentFormat,
  ExtractedDocument,
  ExtractInput,
  DocxRenderer,
  PdfMode,
  PdfRenderer,
  ExtractionMode,
} from "../types.js";
import { DoclingExtractor } from "./docling.js";
import { LibreOfficePdfConverter } from "./libreoffice.js";
import { MarkItDownExtractor } from "./markitdown.js";
import { PandocDocxRenderer, PandocTypstPdfRenderer } from "./pandoc.js";

export interface ProviderSeams {
  /** Substituted for the global `fetch` when talking to docling-serve. */
  readonly fetchImpl?: typeof fetch;
  readonly pandoc?: {
    readonly programPrefixArgs?: readonly string[];
    readonly versionProbe?: () => Promise<string | undefined>;
  };
  readonly libreoffice?: {
    readonly programPrefixArgs?: readonly string[];
    readonly versionProbe?: () => Promise<string | undefined>;
  };
  readonly markitdown?: {
    readonly programPrefixArgs?: readonly string[];
    readonly versionProbe?: () => Promise<string | undefined>;
  };
}

export interface ProviderSet {
  readonly docx: DocxRenderer;
  readonly typstPdf: PdfRenderer | undefined;
  readonly converter: DocumentConverter;
  readonly docling: DocumentExtractor | undefined;
  readonly doclingHealth: (() => Promise<BackendStatus>) | undefined;
  readonly markitdown: DocumentExtractor | undefined;
  readonly markitdownHealth: (() => Promise<BackendStatus>) | undefined;
}

export function createProviders(
  config: ResolvedDocumentsConfig,
  seams: ProviderSeams = {},
): ProviderSet {
  const pandocOptions = {
    executable: config.pandoc.executable,
    timeoutMs: config.pandoc.timeoutMs,
    ...(seams.pandoc?.programPrefixArgs === undefined
      ? {}
      : { programPrefixArgs: seams.pandoc.programPrefixArgs }),
    ...(seams.pandoc?.versionProbe === undefined
      ? {}
      : { versionProbe: seams.pandoc.versionProbe }),
  };
  const pandoc = new PandocDocxRenderer(pandocOptions);
  const docling = config.docling.enabled
    ? new DoclingExtractor({
        baseUrl: config.docling.baseUrl,
        timeoutMs: config.docling.timeoutMs,
        maxResponseBytes: config.limits.maxResponseBytes,
        maxImages: config.limits.maxExtractedImages,
        ...(seams.fetchImpl === undefined
          ? {}
          : { fetchImpl: seams.fetchImpl }),
      })
    : undefined;
  const markitdown = config.markitdown.enabled
    ? new MarkItDownExtractor({
        executable: config.markitdown.executable,
        timeoutMs: config.markitdown.timeoutMs,
        maxStdoutBytes: config.limits.maxExtractedMarkdownBytes,
        ...(seams.markitdown?.programPrefixArgs === undefined
          ? {}
          : { programPrefixArgs: seams.markitdown.programPrefixArgs }),
        ...(seams.markitdown?.versionProbe === undefined
          ? {}
          : { versionProbe: seams.markitdown.versionProbe }),
      })
    : undefined;
  return {
    docx: pandoc,
    typstPdf: config.typst.enabled
      ? new PandocTypstPdfRenderer(pandocOptions)
      : undefined,
    converter: new LibreOfficePdfConverter({
      executable: config.libreoffice.executable,
      timeoutMs: config.libreoffice.timeoutMs,
      ...(seams.libreoffice?.programPrefixArgs === undefined
        ? {}
        : { programPrefixArgs: seams.libreoffice.programPrefixArgs }),
      ...(seams.libreoffice?.versionProbe === undefined
        ? {}
        : { versionProbe: seams.libreoffice.versionProbe }),
    }),
    docling,
    doclingHealth:
      docling === undefined
        ? undefined
        : async () => await (docling as DoclingExtractor).health(),
    markitdown,
    markitdownHealth:
      markitdown === undefined
        ? undefined
        : async () => await (markitdown as MarkItDownExtractor).health(),
  };
}

/**
 * The PDF route (§14.3):
 *
 * ```text
 * DOCX + PDF requested          → office
 * PDF only, template has Typst  → typst
 * otherwise                     → office
 * ```
 *
 * A deployment that asked for `typst` without enabling the engine is answered
 * with `BACKEND_UNAVAILABLE` instead of silently rendering an office PDF in
 * the wrong layout.
 */
export function selectPdfMode(options: {
  readonly requested: PdfMode;
  readonly formats: readonly ("docx" | "pdf")[];
  readonly templateHasTypst: boolean;
  readonly typstEnabled: boolean;
}): "office" | "typst" {
  const wantsDocx = options.formats.includes("docx");
  const resolve = (): "office" | "typst" => {
    if (options.requested === "office") return "office";
    if (options.requested === "typst") return "typst";
    if (wantsDocx) return "office";
    return options.templateHasTypst ? "typst" : "office";
  };
  const mode = resolve();
  if (mode === "typst" && !options.typstEnabled) {
    throw new DocumentError(
      "BACKEND_UNAVAILABLE",
      options.requested === "typst"
        ? "the Typst PDF route is not enabled in this deployment"
        : "this template only provides a Typst layout, but the Typst PDF route is not enabled",
      { backend: "typst" },
    );
  }
  return mode;
}

export interface ExtractorSelection {
  readonly extractor: DocumentExtractor;
  /** Extractors to try, in order, when the first one is unreachable. */
  readonly fallbacks: readonly DocumentExtractor[];
}

export function selectExtractor(
  providers: ProviderSet,
  config: ResolvedDocumentsConfig,
  mode: ExtractionMode,
  format: DocumentFormat,
): ExtractorSelection {
  const docling = providers.docling;
  const markitdown = providers.markitdown;
  if (mode === "fast") {
    if (markitdown !== undefined && markitdown.supports(format)) {
      return {
        extractor: markitdown,
        fallbacks: docling === undefined ? [] : [docling],
      };
    }
    if (docling === undefined) {
      throw new DocumentError(
        "BACKEND_UNAVAILABLE",
        "no document extractor is enabled in this deployment",
        { backend: "docling" },
      );
    }
    return { extractor: docling, fallbacks: [] };
  }
  if (docling !== undefined && docling.supports(format)) {
    const fallbacks =
      config.extraction.allowFallback &&
      markitdown !== undefined &&
      markitdown.supports(format)
        ? [markitdown]
        : [];
    return { extractor: docling, fallbacks };
  }
  if (markitdown !== undefined && markitdown.supports(format)) {
    return { extractor: markitdown, fallbacks: [] };
  }
  throw new DocumentError(
    "BACKEND_UNAVAILABLE",
    `no enabled extractor supports ${format.toUpperCase()} documents`,
    { backend: "docling" },
  );
}

/** Run the selected extractor, falling back only when it is unreachable. */
export async function extractWithFallback(
  selection: ExtractorSelection,
  input: ExtractInput,
): Promise<{ document: ExtractedDocument; fellBackFrom?: string }> {
  try {
    return { document: await selection.extractor.extract(input) };
  } catch (error) {
    const unreachable =
      error instanceof DocumentError &&
      (error.code === "BACKEND_UNAVAILABLE" ||
        error.code === "BACKEND_TIMEOUT");
    const next = selection.fallbacks[0];
    if (!unreachable || next === undefined) throw error;
    const document = await next.extract(input);
    return { document, fellBackFrom: selection.extractor.name };
  }
}
