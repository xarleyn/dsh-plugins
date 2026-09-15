/**
 * Canonical document defaults (§20).
 *
 * This module must stay free of Node builtins: it is the only part of the
 * document subsystem the browser settings bundle reaches (through the QA
 * surface's resolved configuration), and the page cannot load `node:*`. The
 * resolver and everything that touches the filesystem live in `config.ts`,
 * which imports these values.
 */

import { DEFAULT_ASSET_MIME_TYPES } from "./security/mime.js";
import type {
  CreateFormat,
  ExtractionMode,
  OcrMode,
  PdfMode,
} from "./types.js";

export interface QaDocumentsStorageConfig {
  /** Absolute artifact root; `null` means `<session cwd>/.qa/artifacts/documents`. */
  readonly root?: string | null;
  readonly retainSource?: boolean;
  readonly retainInputs?: boolean;
  /** Extra roots an input file may be read from, beside the session workspace. */
  readonly allowedInputRoots?: readonly string[];
}

export interface QaDocumentsTemplatesConfig {
  /** Absolute template root; `null` probes the session workspace. */
  readonly root?: string | null;
  readonly default?: string;
}

export interface QaDocumentsCreateConfig {
  readonly defaultPdfMode?: PdfMode;
  readonly allowFormats?: readonly CreateFormat[];
  readonly allowRawMarkup?: boolean;
  readonly toc?: boolean;
}

export interface QaDocumentsExtractionConfig {
  readonly defaultMode?: ExtractionMode;
  readonly ocr?: OcrMode;
  readonly ocrLanguages?: readonly string[];
  readonly extractImages?: boolean;
  readonly extractTables?: boolean;
  readonly preservePageMarkers?: boolean;
  readonly allowFallback?: boolean;
  /** Markdown returned inline to the model is capped at this many characters. */
  readonly maxInlineChars?: number;
}

export interface QaDocumentsEndpointConfig {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
}

export interface QaDocumentsCommandConfig {
  readonly enabled?: boolean;
  readonly executable?: string;
  readonly timeoutMs?: number;
}

export interface QaDocumentsWorkersConfig {
  readonly renderConcurrency?: number;
  readonly extractionConcurrency?: number;
  readonly ocrConcurrency?: number;
}

export interface QaDocumentsRetentionConfig {
  readonly enabled?: boolean;
  readonly maxAgeDays?: number;
  readonly cleanupIntervalHours?: number;
}

export interface QaDocumentsLimitsConfig {
  readonly maxInputBytes?: number;
  readonly maxMarkdownChars?: number;
  readonly maxPages?: number;
  readonly maxExtractedImages?: number;
  readonly maxAssetBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxExtractedMarkdownBytes?: number;
  readonly allowedAssetMimeTypes?: readonly string[];
}

export interface QaDocumentsConfig {
  readonly enabled?: boolean;
  readonly storage?: QaDocumentsStorageConfig;
  readonly templates?: QaDocumentsTemplatesConfig;
  readonly create?: QaDocumentsCreateConfig;
  readonly extraction?: QaDocumentsExtractionConfig;
  readonly docling?: QaDocumentsEndpointConfig & {
    readonly timeoutMs?: number;
  };
  readonly pandoc?: QaDocumentsCommandConfig;
  readonly libreoffice?: QaDocumentsCommandConfig;
  readonly typst?: QaDocumentsCommandConfig;
  readonly markitdown?: QaDocumentsCommandConfig;
  readonly workers?: QaDocumentsWorkersConfig;
  readonly retention?: QaDocumentsRetentionConfig;
  readonly limits?: QaDocumentsLimitsConfig;
}

export interface ResolvedQaDocumentsConfig {
  readonly enabled: boolean;
  readonly storage: {
    readonly root: string | null;
    readonly retainSource: boolean;
    readonly retainInputs: boolean;
    readonly allowedInputRoots: readonly string[];
  };
  readonly templates: {
    readonly root: string | null;
    readonly default: string;
  };
  readonly create: {
    readonly defaultPdfMode: PdfMode;
    readonly allowFormats: readonly CreateFormat[];
    readonly allowRawMarkup: boolean;
    readonly toc: boolean;
  };
  readonly extraction: {
    readonly defaultMode: ExtractionMode;
    readonly ocr: OcrMode;
    readonly ocrLanguages: readonly string[];
    readonly extractImages: boolean;
    readonly extractTables: boolean;
    readonly preservePageMarkers: boolean;
    readonly allowFallback: boolean;
    readonly maxInlineChars: number;
  };
  readonly docling: {
    readonly enabled: boolean;
    readonly baseUrl: string;
    readonly timeoutMs: number;
  };
  readonly pandoc: { readonly executable: string; readonly timeoutMs: number };
  readonly libreoffice: {
    readonly executable: string;
    readonly timeoutMs: number;
  };
  readonly typst: {
    readonly enabled: boolean;
    readonly executable: string;
    readonly timeoutMs: number;
  };
  readonly markitdown: {
    readonly enabled: boolean;
    readonly executable: string;
    readonly timeoutMs: number;
  };
  readonly workers: {
    readonly renderConcurrency: number;
    readonly extractionConcurrency: number;
    readonly ocrConcurrency: number;
  };
  readonly retention: {
    readonly enabled: boolean;
    readonly maxAgeDays: number;
    readonly cleanupIntervalHours: number;
  };
  readonly limits: {
    readonly maxInputBytes: number;
    readonly maxMarkdownChars: number;
    readonly maxPages: number;
    readonly maxExtractedImages: number;
    readonly maxAssetBytes: number;
    readonly maxResponseBytes: number;
    readonly maxExtractedMarkdownBytes: number;
    readonly allowedAssetMimeTypes: readonly string[];
  };
}

/** The canonical resolved configuration; the schema and resolver both use it. */
export const DEFAULT_QA_DOCUMENTS_CONFIG: ResolvedQaDocumentsConfig =
  Object.freeze({
    enabled: true,
    storage: Object.freeze({
      root: null,
      retainSource: true,
      retainInputs: true,
      allowedInputRoots: Object.freeze([]),
    }),
    templates: Object.freeze({ root: null, default: "default" }),
    create: Object.freeze({
      defaultPdfMode: "auto",
      allowFormats: Object.freeze(["docx", "pdf"] as const),
      allowRawMarkup: false,
      toc: false,
    }),
    extraction: Object.freeze({
      defaultMode: "accurate",
      ocr: "auto",
      ocrLanguages: Object.freeze([]),
      extractImages: true,
      extractTables: true,
      preservePageMarkers: false,
      allowFallback: true,
      maxInlineChars: 200_000,
    }),
    docling: Object.freeze({
      enabled: true,
      baseUrl: "http://docling:5001",
      timeoutMs: 120_000,
    }),
    pandoc: Object.freeze({ executable: "pandoc", timeoutMs: 60_000 }),
    libreoffice: Object.freeze({
      executable: "libreoffice",
      timeoutMs: 120_000,
    }),
    typst: Object.freeze({
      enabled: false,
      executable: "typst",
      timeoutMs: 120_000,
    }),
    markitdown: Object.freeze({
      enabled: false,
      executable: "markitdown",
      timeoutMs: 120_000,
    }),
    workers: Object.freeze({
      renderConcurrency: 2,
      extractionConcurrency: 2,
      ocrConcurrency: 1,
    }),
    retention: Object.freeze({
      enabled: true,
      maxAgeDays: 30,
      cleanupIntervalHours: 12,
    }),
    limits: Object.freeze({
      maxInputBytes: 52_428_800,
      maxMarkdownChars: 5_000_000,
      maxPages: 1_000,
      maxExtractedImages: 500,
      maxAssetBytes: 20_971_520,
      maxResponseBytes: 268_435_456,
      maxExtractedMarkdownBytes: 16_777_216,
      allowedAssetMimeTypes: Object.freeze([...DEFAULT_ASSET_MIME_TYPES]),
    }),
  });
